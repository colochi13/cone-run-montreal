import { createFileRoute } from "@tanstack/react-router";
import { ConeRun } from "@/components/cone-run";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <ConeRun />;
}
