"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, Plus, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { toggleFavorite } from "@/actions/diary";
import { addFoodToShopping } from "@/actions/kitchen";
import { AddFoodDialog, type DayContext } from "@/components/food/add-food-dialog";
import { Button } from "@/components/ui/button";
import { errorText } from "@/lib/errors";
import { useSafeTransition } from "@/lib/use-safe-transition";
import { cn } from "@/lib/utils";

export function FoodActions({ foodId, ctx, canLog, canWrite }: { foodId: string; ctx: DayContext; canLog: boolean; canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  const [fav, setFav] = useState(ctx.favoriteIds.includes(foodId));
  const [pending, start] = useSafeTransition();
  const router = useRouter();
  return (
    <div className="flex flex-wrap gap-2">
      {canLog && canWrite ? (
        <Button onClick={() => setOpen(true)}>
          <Plus /> Añadir al diario
        </Button>
      ) : null}
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              const name = await addFoodToShopping(foodId);
              toast.success(`${name} en la lista de la compra`);
            } catch (e) {
              toast.error(errorText(e, "No se pudo añadir a la compra"));
            }
          })
        }
      >
        <ShoppingCart /> A la compra
      </Button>
      {canWrite ? (
        <Button variant="outline" aria-pressed={fav} disabled={pending} onClick={() => start(async () => setFav(await toggleFavorite(ctx.personId, foodId)))}>
          <Heart className={cn(fav && "fill-persimmon text-persimmon")} /> {fav ? "Favorito" : "Marcar favorito"}
        </Button>
      ) : null}
      {open ? <AddFoodDialog foodId={foodId} ctx={ctx} onClose={() => setOpen(false)} onAdded={() => router.refresh()} /> : null}
    </div>
  );
}
