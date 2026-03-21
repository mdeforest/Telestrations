import { notFound } from "next/navigation";
import { DebugDashboard } from "./DebugDashboard";

export default function DebugPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DebugDashboard />;
}
