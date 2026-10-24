import { Suspense } from "react";
import { RoomClient } from "@/features/room/RoomClient";

export default function RoomPage({ params }: PageProps<"/room/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center bg-[#1a0703] font-pixel text-ash">Memuat room…</div>
      }
    >
      <RoomClient params={params} />
    </Suspense>
  );
}
