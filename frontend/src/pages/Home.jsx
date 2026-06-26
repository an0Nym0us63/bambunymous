import React, { useEffect } from "react";
import { usePrinter } from "../store/printer";
import StatusBanner from "../components/StatusBanner";
import PrinterCard from "../components/PrinterCard";
import AMSGrid from "../components/AMSGrid";
import HotendRackCard from "../components/HotendRackCard";

export default function Home() {
  const { status, startPolling, stopPolling } = usePrinter();

  useEffect(() => {
    startPolling(3000);
    return () => stopPolling();
  }, []);

  const hasRack = status?.hotend_rack?.hotends?.length > 0;

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <StatusBanner status={status} />
      <PrinterCard status={status} />
      {hasRack && <HotendRackCard rack={status.hotend_rack} />}
      <AMSGrid amsList={status?.ams_list ?? []} />
    </div>
  );
}
