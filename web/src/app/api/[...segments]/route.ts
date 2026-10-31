import { supabasePublic, supabaseServer } from "@/lib/supabase/server";
import { ensureAccountProfile } from "@/lib/account-profile";
import { accountSetupError } from "@/lib/account-setup";
import { parseAccountRoles } from "@/lib/roles";

type JsonObject = Record<string, unknown>;
type RouteContext = { params: Promise<{ segments: string[] }> };
type RpcError = { code: string; message: string };

const TASK_TYPES = new Set([
  "buy_and_bring",
  "collect",
  "drop_and_submit",
  "queue_and_wait",
  "multi_stop",
  "send",
]);
const TRANSITIONS = new Set(["picked_up", "on_the_way", "needs_ops", "failed", "paid", "assigned"]);
const FAILURE_REASONS = new Set([
  "customer_unreachable",
  "wrong_address",
  "item_unavailable",
  "runner_issue",
  "safety_issue",
  "other",
]);
const PROOF_KINDS = new Set(["photo", "receipt", "stamped_copy", "timestamped_photo"]);
const RUNNER_STATUSES = new Set(["applied", "in_review", "verified", "suspended", "rejected"]);
const FORBIDDEN_ERRORS = new Set(["FORBIDDEN", "NOT_VERIFIED", "RUNNER_UNAVAILABLE"]);
const CONFLICT_ERRORS = new Set(["RUNNER_BUSY", "NOT_DISPATCHABLE", "OFFER_CLOSED", "OFFER_EXPIRED", "PRICE_FROZEN"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function configurationResponse() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  return Response.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });
}

function isUuid(value: string) {
  return UUID.test(value);
}

async function readBody(request: Request): Promise<JsonObject | Response> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON.");
  }
  return isObject(value) ? value : badRequest("Request body must be a JSON object.");
}

function validJobInput(value: JsonObject) {
  if (typeof value.task_type !== "string" || !TASK_TYPES.has(value.task_type)) return false;
  if (!Array.isArray(value.stops) || value.stops.length < 1 || value.stops.length > 3) return false;
  return value.stops.every((stop) => {
    if (!isObject(stop)) return false;
    return (
      typeof stop.address === "string" &&
      stop.address.trim().length > 0 &&
      stop.address.length <= 300 &&
      typeof stop.lat === "number" &&
      Number.isFinite(stop.lat) &&
      stop.lat >= -90 &&
      stop.lat <= 90 &&
      typeof stop.lng === "number" &&
      Number.isFinite(stop.lng) &&
      stop.lng >= -180 &&
      stop.lng <= 180
    );
  });
}

function rpcResponse(data: unknown, error: RpcError | null, successStatus = 200) {
  if (!error) return Response.json({ data }, { status: successStatus });

  if (error.code === "P0001") {
    const code = error.message.split(":")[0] || "REQUEST_REJECTED";
    if (code === "AUTH_REQUIRED") return Response.json({ error: code }, { status: 401 });
    if (FORBIDDEN_ERRORS.has(code)) return Response.json({ error: code }, { status: 403 });
    if (CONFLICT_ERRORS.has(code)) return Response.json({ error: code }, { status: 409 });
    return Response.json({ error: code }, { status: 400 });
  }
  if (error.code === "AUTH_EMAIL_REQUIRED") {
    return Response.json({ error: error.code }, { status: 400 });
  }
  if (error.code === "42501") return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  if (error.code === "23505") return Response.json({ error: "CONFLICT" }, { status: 409 });
  if (error.code.startsWith("22") || error.code === "23514") {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  console.error("Supabase API request failed", { code: error.code, message: error.message });
  return Response.json({ error: "INTERNAL_ERROR" }, { status: 500 });
}

async function signedInClient() {
  const configurationError = configurationResponse();
  if (configurationError) return { response: configurationError } as const;
  const client = await supabaseServer();
  const { data, error } = await client.auth.getUser();
  if (error && (error.status === 401 || error.status === 403)) {
    return { response: Response.json({ error: "AUTH_REQUIRED" }, { status: 401 }) } as const;
  }
  if (error) {
    console.error("Supabase authentication verification failed", { message: error.message, status: error.status });
    return { response: Response.json({ error: "AUTH_VERIFICATION_FAILED" }, { status: 503 }) } as const;
  }
  if (!data.user) {
    return { response: Response.json({ error: "AUTH_REQUIRED" }, { status: 401 }) } as const;
  }
  return { client, user: data.user } as const;
}

function validCoordinates(point: JsonObject) {
  return (
    typeof point.lat === "number" &&
    Number.isFinite(point.lat) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    typeof point.lng === "number" &&
    Number.isFinite(point.lng) &&
    point.lng >= -180 &&
    point.lng <= 180
  );
}

export async function GET(_request: Request, context: RouteContext) {
  const { segments } = await context.params;

  if (segments.length === 2 && segments[0] === "account" && segments[1] === "roles") {
    const auth = await signedInClient();
    if ("response" in auth) return auth.response;
    const { data, error } = await auth.client
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: true });
    if (error) {
      const setupError = accountSetupError("roles", error);
      if (setupError) return Response.json({ error: setupError }, { status: 503 });
      return rpcResponse(null, error);
    }
    return Response.json(
      { data: data.map(({ role }) => role) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (segments.length === 1 && segments[0] === "jobs") {
    const auth = await signedInClient();
    if ("response" in auth) return auth.response;
    const { data, error } = await auth.client
      .from("jobs")
      .select("id,ref,product,task_type,status,price_kobo,item_budget_kobo,created_at,updated_at,promised_by")
      .eq("customer_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return rpcResponse(null, error);
    return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
  }

  if (segments.length === 2 && segments[0] === "tracking") {
    const token = segments[1];
    if (!token || token.length > 200) return badRequest("Invalid tracking token.");
    const configurationError = configurationResponse();
    if (configurationError) return configurationError;

    const { data, error } = await supabasePublic().rpc("get_tracking", { p_token: token });
    if (error) return rpcResponse(null, error);
    if (!data) return Response.json({ error: "LINK_NOT_FOUND" }, { status: 404 });
    return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
  }

  if (segments.length === 2 && segments[0] === "ops" && segments[1] === "alerts") {
    const auth = await signedInClient();
    if ("response" in auth) return auth.response;
    const { data, error } = await auth.client.rpc("ops_alerts");
    return rpcResponse(data, error);
  }

  if (segments.length === 2 && segments[0] === "ops" && segments[1] === "jobs") {
    const auth = await signedInClient();
    if ("response" in auth) return auth.response;
    const { data, error } = await auth.client
      .from("jobs")
      .select("id,ref,product,task_type,status,price_kobo,customer_id,runner_id,created_at,updated_at,promised_by")
      .in("status", ["paid", "assigned", "picked_up", "on_the_way", "needs_ops", "customer_approval"])
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return rpcResponse(null, error);
    return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
  }

  if (segments.length === 2 && segments[0] === "ops" && segments[1] === "runners") {
    const auth = await signedInClient();
    if ("response" in auth) return auth.response;
    const { data, error } = await auth.client
      .from("runners")
      .select("user_id,full_name,vehicle,status,online,last_seen_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return rpcResponse(null, error);
    return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
  }

  if (segments.length === 2 && segments[0] === "runner" && segments[1] === "offers") {
    const auth = await signedInClient();
    if ("response" in auth) return auth.response;
    const { data: offers, error } = await auth.client
      .from("offers")
      .select("id,job_id,earnings_kobo,offered_at,expires_at,response")
      .eq("runner_id", auth.user.id)
      .eq("response", "pending")
      .order("offered_at", { ascending: true })
      .limit(20);
    if (error) return rpcResponse(null, error);
    const jobIds = offers.map((offer) => offer.job_id);
    if (jobIds.length === 0) return Response.json({ data: [] }, { headers: { "Cache-Control": "no-store" } });
    const { data: jobs, error: jobsError } = await auth.client
      .from("jobs")
      .select("id,ref,task_type,status")
      .in("id", jobIds);
    if (jobsError) return rpcResponse(null, jobsError);
    const jobById = new Map(jobs.map((job) => [job.id, job]));
    const data = offers.map((offer) => ({ ...offer, job: jobById.get(offer.job_id) ?? null }));
    return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
  }

  if (segments.length === 2 && segments[0] === "runner" && segments[1] === "jobs") {
    const auth = await signedInClient();
    if ("response" in auth) return auth.response;
    const { data, error } = await auth.client
      .from("jobs")
      .select("id,ref,product,task_type,status,price_kobo,item_budget_kobo,created_at,updated_at,promised_by")
      .eq("runner_id", auth.user.id)
      .in("status", ["assigned", "picked_up", "on_the_way", "needs_ops", "customer_approval"])
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return rpcResponse(null, error);
    return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
  }

  if (segments.length === 2 && segments[0] === "runner" && segments[1] === "profile") {
    const auth = await signedInClient();
    if ("response" in auth) return auth.response;
    const { data, error } = await auth.client
      .from("runners")
      .select("user_id,full_name,vehicle,status,online,last_seen_at")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (error) return rpcResponse(null, error);
    if (!data) return Response.json({ error: "RUNNER_PROFILE_NOT_FOUND" }, { status: 404 });
    return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
  }

  if (segments.length === 4 && segments[0] === "ops" && segments[1] === "jobs" && segments[3] === "suggestions") {
    const jobId = segments[2];
    if (!isUuid(jobId)) return badRequest("Invalid job ID.");
    const auth = await signedInClient();
    if ("response" in auth) return auth.response;
    const url = new URL(_request.url);
    const requestedLimit = url.searchParams.get("limit");
    const limit = requestedLimit === null ? 5 : Number(requestedLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) return badRequest("limit must be an integer from 1 to 10.");
    const { data, error } = await auth.client.rpc("suggest_runners", { p_job: jobId, p_limit: limit });
    return rpcResponse(data, error);
  }

  return Response.json({ error: "NOT_FOUND" }, { status: 404 });
}

export async function POST(request: Request, context: RouteContext) {
  const { segments } = await context.params;
  const payload = await readBody(request);
  if (payload instanceof Response) return payload;

  if (segments.length === 2 && segments[0] === "account" && segments[1] === "profile") {
    const auth = await signedInClient();
    if ("response" in auth) return auth.response;
    const { data, error } = await ensureAccountProfile(auth.client, auth.user);
    if (error) {
      const setupError = accountSetupError("profile", error);
      if (setupError) {
        console.error("Email authentication requires the profile phone migration", error);
        return Response.json({ error: setupError }, { status: 503 });
      }
      return rpcResponse(null, error);
    }
    return Response.json({ data }, { status: 201, headers: { "Cache-Control": "no-store" } });
  }

  if (segments.length === 2 && segments[0] === "account" && segments[1] === "roles") {
    const roles = parseAccountRoles(payload.roles);
    if (!roles) return badRequest("Choose one or more supported account roles.");
    const auth = await signedInClient();
    if ("response" in auth) return auth.response;

    const { error } = await auth.client.from("user_roles").upsert(
      roles.map((role) => ({ user_id: auth.user.id, role })),
      { onConflict: "user_id,role", ignoreDuplicates: true },
    );
    if (error) {
      const setupError = accountSetupError("roles", error);
      if (setupError) return Response.json({ error: setupError }, { status: 503 });
      return rpcResponse(null, error);
    }

    const { data, error: rolesError } = await auth.client
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: true });
    if (rolesError) {
      const setupError = accountSetupError("roles", rolesError);
      if (setupError) return Response.json({ error: setupError }, { status: 503 });
      return rpcResponse(null, rolesError);
    }
    return Response.json(
      { data: data.map(({ role }) => role) },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (segments.length === 2 && segments[0] === "jobs" && segments[1] === "quote") {
    if (!validJobInput(payload)) return badRequest("Provide a supported task type and 1–3 stops with addresses and map coordinates.");
    const configurationError = configurationResponse();
    if (configurationError) return configurationError;
    const { data, error } = await supabasePublic().rpc("quote_job", { p_input: payload });
    return rpcResponse(data, error);
  }

  if (segments.length === 1 && segments[0] === "waitlist") {
    const { phone, reason, name, note, lat, lng } = payload;
    if (
      typeof phone !== "string" ||
      phone.trim().length < 7 ||
      phone.trim().length > 25 ||
      typeof reason !== "string" ||
      !["outside_zone", "companion", "other"].includes(reason) ||
      (name !== undefined && (typeof name !== "string" || name.length > 120)) ||
      (note !== undefined && (typeof note !== "string" || note.length > 1000)) ||
      ((lat === undefined) !== (lng === undefined)) ||
      (lat !== undefined && (typeof lat !== "number" || typeof lng !== "number" || !validCoordinates({ lat, lng })))
    ) {
      return badRequest("Provide a valid phone, reason, and optional name, note, and map coordinates.");
    }

    const configurationError = configurationResponse();
    if (configurationError) return configurationError;
    const { data, error } = await supabasePublic().rpc("join_waitlist", {
      p_phone: phone.trim(),
      p_reason: reason,
      p_name: name ?? null,
      p_lat: lat ?? null,
      p_lng: lng ?? null,
      p_note: note ?? null,
    });
    return rpcResponse(data, error, 201);
  }

  if (segments.length === 1 && segments[0] === "jobs") {
    if (!validJobInput(payload)) return badRequest("Provide a supported task type and 1–3 stops with addresses and map coordinates.");
    const auth = await signedInClient();
    if ("response" in auth) return auth.response;
    const { data, error } = await auth.client.rpc("create_job", { p_input: payload });
    return rpcResponse(data ? { job_id: data } : null, error, 201);
  }

  if (segments.length === 2 && segments[0] === "runner" && segments[1] === "online") {
    if (typeof payload.online !== "boolean") return badRequest("online must be a boolean.");
    const auth = await signedInClient();
    if ("response" in auth) return auth.response;
    const { data, error } = await auth.client.rpc("set_online", { p_online: payload.online });
    return rpcResponse(data, error);
  }

  if (segments.length === 3 && segments[0] === "runner" && segments[1] === "offers") {
    const offerId = segments[2];
    if (!isUuid(offerId) || typeof payload.accept !== "boolean") return badRequest("Provide a valid offer ID and accept boolean.");
    const auth = await signedInClient();
    if ("response" in auth) return auth.response;
    const { data, error } = await auth.client.rpc("respond_to_offer", { p_offer: offerId, p_accept: payload.accept });
    return rpcResponse(data, error);
  }

  if (segments.length === 4 && segments[0] === "runner" && segments[1] === "jobs") {
    const jobId = segments[2];
    if (!isUuid(jobId)) return badRequest("Invalid job ID.");
    const auth = await signedInClient();
    if ("response" in auth) return auth.response;

    if (segments[3] === "transition") {
      if (typeof payload.to !== "string" || !TRANSITIONS.has(payload.to)) return badRequest("Unsupported job transition.");
      if (payload.reason !== undefined && (typeof payload.reason !== "string" || payload.reason.length > 1000)) {
        return badRequest("reason must be a string of at most 1000 characters.");
      }
      if (payload.reason_code !== undefined && (typeof payload.reason_code !== "string" || !FAILURE_REASONS.has(payload.reason_code))) {
        return badRequest("Unsupported failure reason.");
      }
      const { data, error } = await auth.client.rpc("transition_job", {
        p_job: jobId,
        p_to: payload.to,
        p_reason: payload.reason ?? null,
        p_reason_code: payload.reason_code ?? null,
      });
      return rpcResponse(data, error);
    }

    if (segments[3] === "complete") {
      if (payload.otp !== undefined && (typeof payload.otp !== "string" || payload.otp.length > 20)) {
        return badRequest("otp must be a string of at most 20 characters.");
      }
      const { data, error } = await auth.client.rpc("complete_job", { p_job: jobId, p_otp: payload.otp ?? null });
      return rpcResponse(data, error);
    }

    if (segments[3] === "locations") {
      if (
        !Array.isArray(payload.points) ||
        payload.points.length < 1 ||
        payload.points.length > 100 ||
        !payload.points.every((point) => isObject(point) && validCoordinates(point) && typeof point.at === "string" && Number.isFinite(Date.parse(point.at)))
      ) {
        return badRequest("Provide 1–100 location points with valid coordinates and timestamps.");
      }
      const { data, error } = await auth.client.rpc("record_locations", { p_job: jobId, p_points: payload.points });
      return rpcResponse(data, error);
    }

    if (segments[3] === "proof") {
      if (
        typeof payload.kind !== "string" ||
        !PROOF_KINDS.has(payload.kind) ||
        typeof payload.path !== "string" ||
        payload.path.trim().length === 0 ||
        payload.path.length > 500 ||
        (payload.stop_seq !== undefined && (!Number.isInteger(payload.stop_seq) || Number(payload.stop_seq) < 1 || Number(payload.stop_seq) > 3))
      ) {
        return badRequest("Provide a supported proof kind, storage path, and optional stop sequence.");
      }
      const { data, error } = await auth.client.rpc("add_proof", {
        p_job: jobId,
        p_kind: payload.kind,
        p_path: payload.path,
        p_stop_seq: payload.stop_seq ?? null,
      });
      return rpcResponse(data ? { proof_id: data } : null, error, 201);
    }

    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  if (segments.length === 4 && segments[0] === "ops" && segments[1] === "jobs" && segments[3] === "dispatch") {
    const jobId = segments[2];
    if (!isUuid(jobId)) return badRequest("Invalid job ID.");
    const auth = await signedInClient();
    if ("response" in auth) return auth.response;

    if (!isObject(payload) || typeof payload.runner_id !== "string" || !isUuid(payload.runner_id)) {
      return badRequest("Provide a valid runner_id.");
    }
    if (payload.mode === "offer") {
      const { data, error } = await auth.client.rpc("offer_job", {
        p_job: jobId,
        p_runner: payload.runner_id,
        p_seconds: 45,
      });
      return rpcResponse(data ? { offer_id: data } : null, error, 201);
    }
    if (payload.mode === "assign" && typeof payload.reason === "string" && payload.reason.trim().length > 0) {
      const { data, error } = await auth.client.rpc("ops_assign", {
        p_job: jobId,
        p_runner: payload.runner_id,
        p_reason: payload.reason.trim(),
      });
      return rpcResponse(data, error);
    }
    return badRequest("mode must be offer or assign; direct assignment also requires a reason.");
  }

  if (segments.length === 4 && segments[0] === "ops" && segments[1] === "runners" && segments[3] === "status") {
    const runnerId = segments[2];
    if (
      !isUuid(runnerId) ||
      typeof payload.status !== "string" ||
      !RUNNER_STATUSES.has(payload.status) ||
      typeof payload.note !== "string" ||
      payload.note.trim().length === 0 ||
      payload.note.length > 1000
    ) {
      return badRequest("Provide a valid runner_id, status, and non-empty note.");
    }
    const auth = await signedInClient();
    if ("response" in auth) return auth.response;
    const { data, error } = await auth.client.rpc("ops_set_runner_status", {
      p_runner: runnerId,
      p_status: payload.status,
      p_note: payload.note.trim(),
    });
    return rpcResponse(data, error);
  }

  return Response.json({ error: "NOT_FOUND" }, { status: 404 });
}
