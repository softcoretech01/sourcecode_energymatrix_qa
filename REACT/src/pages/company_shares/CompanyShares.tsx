import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import api from "@/services/api";

export default function CompanyShares() {
    const [totalShares, setTotalShares] = useState<string>("");
    const [investorShares, setInvestorShares] = useState<string>("");
    const [totalId, setTotalId] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);

    // Computed customer shares: Total - Investor
    const customerShares = (Number(totalShares || 0) - Number(investorShares || 0)).toString();

    useEffect(() => {
        fetchTotalShares();
    }, []);

    const fetchTotalShares = async () => {
        try {
            console.log("Fetching company shares...");
            const res = await api.get("/total-shares");
            console.log("Company shares data:", res.data);
            if (Array.isArray(res.data) && res.data.length > 0) {
                const first = res.data[0];
                setTotalShares(String(first.total_company_shares ?? "0"));
                setInvestorShares(String(first.total_investor_shares ?? "0"));
                setTotalId(first.id ?? 1);
            }
        } catch (error) {
            console.error("Error fetching total shares", error);
        }
    };

    const handleSave = async () => {
        if (saving) return;

        if (!totalShares || Number(totalShares) < 0) {
            toast({
                variant: "destructive",
                title: "Invalid total shares",
                description: "Please enter a valid total company shares quantity.",
            });
            return;
        }

        if (Number(investorShares) > Number(totalShares)) {
            toast({
                variant: "destructive",
                title: "Invalid investor shares",
                description: "Investor shares cannot exceed total company shares.",
            });
            return;
        }

        setSaving(true);
        try {
            const payload = {
                total_company_shares: Number(totalShares),
                investor_shares: Number(investorShares),
                is_submitted: 0,
            };

            if (totalId) {
                await api.put(`/total-shares/${totalId}`, payload);
            } else {
                const res = await api.post("/total-shares", payload);
                setTotalId(res.data?.id ?? 1);
            }

            toast({ title: "Company shares updated successfully" });
            fetchTotalShares();
        } catch (error) {
            console.error(error);
            toast({
                variant: "destructive",
                title: "Failed to update shares",
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="p-3 bg-slate-50 min-h-screen font-sans">
            <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                    <h1 className="text-lg font-semibold text-indigo-700">Master Company Shares</h1>
                </div>

                <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="space-y-1.5">
                            <label className="text-sm font-semibold text-slate-700">Total No.of Shares</label>
                            <Input
                                value={totalShares}
                                onChange={(e) => setTotalShares(e.target.value)}
                                placeholder="Enter total shares"
                                type="number"
                                className="bg-white border-slate-300 h-10"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-sm font-semibold text-slate-700">Total Investor Shares</label>
                            <Input
                                value={investorShares}
                                onChange={(e) => setInvestorShares(e.target.value)}
                                placeholder="Enter investor shares"
                                type="number"
                                className="bg-white border-slate-300 h-10"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-sm font-semibold text-slate-700">Total No.of Customer Shares</label>
                            <Input
                                value={Number(totalShares) ? customerShares : "0"}
                                readOnly
                                className="bg-slate-50 border-slate-300 h-10 text-slate-500 font-medium"
                            />
                        </div>
                    </div>

                    <div className="flex justify-start pt-4">
                        <Button
                            className="bg-blue-600 hover:bg-blue-700 text-white h-10 px-8 shadow-sm"
                            disabled={saving}
                            onClick={handleSave}
                        >
                            {saving ? "Updating..." : "Save Company Shares"}
                        </Button>
                    </div>

                </div>
            </div>
        </div>
    );
}
