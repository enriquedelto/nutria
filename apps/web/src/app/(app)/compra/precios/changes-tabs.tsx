"use client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function ChangesTabs({ three, twelve }: { three: React.ReactNode; twelve: React.ReactNode }) {
  return (
    <Tabs defaultValue="3">
      <TabsList>
        <TabsTrigger value="3">3 meses</TabsTrigger>
        <TabsTrigger value="12">12 meses</TabsTrigger>
      </TabsList>
      <TabsContent value="3" className="mt-2">
        {three}
      </TabsContent>
      <TabsContent value="12" className="mt-2">
        {twelve}
      </TabsContent>
    </Tabs>
  );
}
