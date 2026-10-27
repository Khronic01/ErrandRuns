(function () {
  // Orders go to this WhatsApp number (0814 069 4034, Nigeria +234).
  var WHATSAPP = "2348140694034";

  function waLink(text) {
    return "https://wa.me/" + WHATSAPP + (text ? "?text=" + encodeURIComponent(text) : "");
  }

  // Count a button tap as an event on the GoatCounter dashboard.
  function track(name, title) {
    try {
      if (window.goatcounter && window.goatcounter.count) {
        window.goatcounter.count({ path: name, title: title || name, event: true });
      }
    } catch (e) { /* counting must never block an order */ }
  }

  document.querySelectorAll(".wa-direct").forEach(function (a) {
    a.href = waLink("Hello Errand Runs, I'd like to ask about an errand.");
    a.addEventListener("click", function () { track("whatsapp-chat", "Tapped Chat on WhatsApp"); });
  });

  document.getElementById("runnerApply").href = waLink(
    "Hello Errand Runs, I'd like to become a runner.\n\n*My name:* \n*Area I live in:* \n*I run on:* bike / foot");
  document.getElementById("runnerApply").addEventListener("click", function () {
    track("runner-apply", "Tapped Apply on WhatsApp (runner)");
  });

  /* ---------- hero: one errand, start to finish ---------- */
  var run = document.getElementById("run");
  var route = document.getElementById("route");
  var steps = document.querySelectorAll("#steps li");
  var len = route.getTotalLength();
  run.style.setProperty("--len", len);

  // progress along the route at each step
  var progress = [0, 0, 0, 0.42, 1, 1];
  function show(step) {
    run.dataset.step = step;
    run.style.setProperty("--p", progress[step]);
    steps.forEach(function (li, i) {
      li.classList.toggle("on", i < step || (step === 5 && i === 4));
      li.classList.toggle("now", i === step - 1 && step < 5);
    });
  }

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var timer = null, step = 0;
  function tick() {
    step = step >= 5 ? 0 : step + 1;
    show(step);
    timer = setTimeout(tick, step === 5 ? 3200 : step === 0 ? 900 : 1800);
  }
  function start() {
    clearTimeout(timer);
    if (reduce.matches) { show(5); return; }
    step = 0; show(0);
    timer = setTimeout(tick, 900);
  }
  reduce.addEventListener ? reduce.addEventListener("change", start) : reduce.addListener(start);
  // only animate while the card is on screen
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) start(); else clearTimeout(timer);
    }, { threshold: 0.3 }).observe(run);
  } else { start(); }

  /* ---------- order form ---------- */
  var form = document.getElementById("orderForm");
  var bubble = document.getElementById("bubble");
  var $ = function (id) { return document.getElementById(id); };

  var COPY = {
    "Buy & bring":   { from: ["Where to buy from", "e.g. Shoprite, Ozone Mall, Yaba"], to: "Deliver to",
                       details: ["Your shopping list", "e.g. Peak milk 3-pack, 2 loaves of bread. If something isn't available, call me."], budget: true, needsTo: true },
    "Pick up":       { from: ["Pick up from", "e.g. Mr Clean dry cleaners, Bode Thomas"], to: "Deliver to",
                       details: ["What are we picking up?", "e.g. 3 shirts, ticket number 4471. Ask for Musa."], budget: false, needsTo: true },
    "Drop & submit": { from: ["Collect the documents from", "Your address"], to: "Submit at",
                       details: ["What should we submit, and to whom?", "e.g. Signed form to the front desk, ask for a stamped copy."], budget: false, needsTo: true },
    "Queue for me":  { from: ["Where's the queue?", "e.g. GTBank, Herbert Macaulay Way"], to: "",
                       details: ["What are we queueing for?", "e.g. Collect my new ATM card. Wait up to 90 minutes."], budget: false, needsTo: false },
    "Send a parcel": { from: ["Pick up from", "Sender's address"], to: "Deliver to",
                       details: ["What are we sending?", "e.g. Small bag of clothes, about 2kg. Handle with care."], budget: false, needsTo: true },
    "Something else":{ from: ["Where do we start?", "Address and area"], to: "Where does it end?",
                       details: ["Describe the errand", "Up to three stops. Tell us everything the runner needs to know."], budget: true, needsTo: false }
  };

  function type() { return form.querySelector('input[name="type"]:checked').value; }
  function val(id) { return $(id).value.trim(); }
  function setOpen(id, open) { $(id).classList.toggle("open", open); }

  function applyType() {
    var c = COPY[type()];
    $("fromLabel").textContent = c.from[0];
    $("from").placeholder = c.from[1];
    $("detailsLabel").textContent = c.details[0];
    $("details").placeholder = c.details[1];
    setOpen("toBlock", !!c.to);
    if (c.to) {
      $("toLabel").innerHTML = c.to + (c.needsTo ? "" : ' <span class="hint">(optional)</span>');
    }
    $("to").required = !!c.needsTo;
    setOpen("budgetBlock", c.budget);
    update();
  }

  function place(addr, landmark) {
    return addr + (landmark ? " (landmark: " + landmark + ")" : "");
  }

  function message() {
    var c = COPY[type()];
    var lines = ["Hello Errand Runs, I'd like to order an errand.", ""];
    lines.push("*Errand:* " + type());
    lines.push("*" + c.from[0].replace(/\?$/, "") + ":* " + (val("from") ? place(val("from"), val("fromLandmark")) : "…"));
    if (c.to && (c.needsTo || val("to"))) {
      lines.push("*" + c.to.replace(/\?$/, "") + ":* " + (val("to") ? place(val("to"), val("toLandmark")) : "…"));
    }
    lines.push("*Details:* " + (val("details") || "…"));
    if (c.budget && val("budget")) {
      var n = Number(val("budget").replace(/[^\d]/g, ""));
      if (n) lines.push("*Budget for items:* ₦" + n.toLocaleString("en-NG"));
    }
    var when = $("when").value;
    if (when === "Later today" && val("time")) when += ", around " + val("time");
    lines.push("*When:* " + when);
    lines.push("*My name:* " + (val("name") || "…"));
    if ($("someoneElse").checked) {
      lines.push("*Recipient:* " + (val("rName") || "…") + (val("rPhone") ? ", " + val("rPhone") : ""));
    }
    return lines.join("\n");
  }

  // Render *bold* the way WhatsApp will, without trusting typed text as HTML.
  function render(text) {
    bubble.textContent = "";
    text.split(/(\*[^*\n]+\*)/).forEach(function (part) {
      if (/^\*[^*\n]+\*$/.test(part)) {
        var b = document.createElement("b"); b.textContent = part.slice(1, -1); bubble.appendChild(b);
      } else if (part) {
        bubble.appendChild(document.createTextNode(part));
      }
    });
  }

  var last = "";
  function update() {
    var m = message();
    if (m === last) return;
    last = m;
    render(m);
  }

  function validate() {
    var firstBad = null;
    form.querySelectorAll("[data-field]").forEach(function (wrap) {
      var input = wrap.querySelector("input, textarea");
      var hidden = wrap.closest(".reveal") && !wrap.closest(".reveal").classList.contains("open");
      var needed = input.required || (input.id === "rName" || input.id === "rPhone") && $("someoneElse").checked;
      var bad = !hidden && needed && !input.value.trim();
      if (input.id === "rPhone" && !bad && needed) bad = input.value.replace(/\D/g, "").length < 10;
      wrap.classList.toggle("invalid", bad);
      if (bad && !firstBad) firstBad = input;
    });
    if (firstBad) firstBad.focus();
    return !firstBad;
  }

  form.addEventListener("input", function (e) {
    var wrap = e.target.closest("[data-field]");
    if (wrap) wrap.classList.remove("invalid");
    update();
  });
  form.addEventListener("change", function (e) {
    if (e.target.name === "type") applyType();
    if (e.target.id === "when") setOpen("timeBlock", e.target.value === "Later today");
    if (e.target.id === "someoneElse") setOpen("recipientBlock", e.target.checked);
    update();
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!validate()) return;
    var t = type();
    track("order-sent/" + t.toLowerCase().replace(/[^a-z]+/g, "-"), "Sent order: " + t);
    window.open(waLink(message()), "_blank", "noopener");
  });

  applyType();

  /* floating button appears once the hero is out of view */
  var fab = $("fab");
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      fab.classList.toggle("show", !entries[0].isIntersecting);
    }).observe(document.querySelector(".hero"));
  } else { fab.classList.add("show"); }
})();
