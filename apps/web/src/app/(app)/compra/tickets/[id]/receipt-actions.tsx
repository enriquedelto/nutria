"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteReceipt, retryReceiptShare } from "@/actions/receipts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { errorText } from "@/lib/errors";
import { useSafeTransition } from "@/lib/use-safe-transition";

export function ReceiptActions({ receiptId, canRetryShare }: { receiptId: string; canRetryShare: boolean }) {
  const [ask, setAsk] = useState(false);
  const [pending, start] = useSafeTransition();
  const router = useRouter();
  const run = (fn: () => Promise<void>, ok: string) =>
    start(async () => {
      try {
        await fn();
        toast.success(ok);
      } catch (e) {
        toast.error(errorText(e, "No se pudo"));
      }
    });
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" asChild>
        <Link href={`/compra/tickets/${receiptId}?editar=1`}>
          <Pencil /> Editar
        </Link>
      </Button>
      {canRetryShare ? (
        <Button variant="outline" disabled={pending} onClick={() => run(() => retryReceiptShare(receiptId), "Reintentando en Open Prices")}>
          <RefreshCw /> Reintentar Open Prices
        </Button>
      ) : null}
      <Button variant="outline" onClick={() => setAsk(true)}>
        <Trash2 /> Borrar
      </Button>
      {ask ? (
        <Dialog open onOpenChange={(o) => !o && setAsk(false)}>
          <DialogContent title="¿Borrar el ticket?" description="Se borran las fotos y los precios que guardó. Lo ya compartido en Open Prices se queda allí.">
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setAsk(false)}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    try {
                      await deleteReceipt(receiptId);
                      toast.success("Ticket borrado");
                      router.replace("/compra/tickets");
                    } catch (e) {
                      toast.error(errorText(e, "No se pudo borrar"));
                    }
                  })
                }
              >
                Borrar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
