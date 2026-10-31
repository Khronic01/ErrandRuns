import type { Metadata } from "next";
import CustomerOrders from "@/components/customer-orders";

export const metadata: Metadata = { title: "Your orders", robots: { index: false } };

export default function OrdersPage() {
  return <CustomerOrders />;
}
