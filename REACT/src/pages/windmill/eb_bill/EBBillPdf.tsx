import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Building2, Calendar, Hash, Info, Save } from "lucide-react";
import { useNavigate } from "react-router-dom";
import api from "@/services/api";

export default function EBBillPdf() {
    const navigate = useNavigate();
    const [ebData, setEbData] = useState<any>(null);
    const [chargeLabels, setChargeLabels] = useState<Record<string, string>>({});

    const oaRows = ebData?.matched_rows || [];
    const columns = ebData?.columns || [];

    useEffect(() => {
        // Fetch official charge labels for display
        api.get("/eb-bill/charge-labels")
            .then(res => setChargeLabels(res.data))
            .catch(err => console.error("Failed to fetch charge labels:", err));

        const stored = sessionStorage.getItem("ebData");
        if (!stored) {
            console.warn("No ebData in sessionStorage, redirecting...");
            navigate("/windmill/eb-bill/add", { replace: true });
            return;
        }
        try {
            const parsed = JSON.parse(stored);
            setEbData(parsed);
        } catch (e) {
            console.error("Failed to parse ebData:", e);
            navigate("/windmill/eb-bill/add", { replace: true });
        }
    }, [navigate]);

    const handleSave = async () => {
        if (!ebData || !ebData.header_id) {
            alert("Record header missing, cannot save.");
            return;
        }

        if (!ebData.customer_id || !ebData.service_number_id) {
            alert("Customer ID or Service Number ID missing. Please reselect from dropdown.");
            return;
        }

        try {
            const payload = {
                header_id: parseInt(ebData.header_id, 10),
                customer_id: parseInt(ebData.customer_id, 10),
                service_number_id: parseInt(ebData.service_number_id, 10),
                self_generation_tax: ebData.self_generation_tax || "0",
                columns: ebData.columns || [],
                matched_rows: ebData.matched_rows || []
            };

            // Validate payload
            if (!payload.matched_rows || payload.matched_rows.length === 0) {
                alert("No windmill data to save. Please ensure windmill charges are present.");
                return;
            }

            console.log("Saving EB Bill with payload:", payload);
            const res = await api.post("/eb-bill/save-all", payload);
            
            if (res.status === 200 && res.data?.status === "success") {
                alert("✓ EB Bill details saved successfully!");
                // Clear session storage and navigate
                sessionStorage.removeItem("ebData");
                sessionStorage.removeItem("ebPdfUrl");
                navigate("/windmill/eb-bill", { replace: true });
            } else {
                const errorMsg = res.data?.detail || res.data?.message || "Unknown error";
                console.error("Server response:", res.data);
                alert(`Failed to save: ${errorMsg}`);
            }
        } catch (err: any) {
            console.error("Save failed", err);
            const serverError = err?.response?.data?.detail || err?.response?.data?.message || err?.message || "Check console for details";
            alert(`Error saving details:\n\n${serverError}`);
        }
    };

    // Show error state if no data
    if (!ebData || !ebData.matched_rows) {
        return (
            <div className="min-h-screen bg-gray-100 p-8 flex items-center justify-center">
                <div className="bg-white rounded-lg shadow-lg p-8 text-center max-w-md">
                    <p className="text-gray-600 mb-4 text-lg">No PDF data available</p>
                    <p className="text-gray-500 mb-6">Please go back and upload a PDF first.</p>
                    <Button onClick={() => navigate("/windmill/eb-bill/add")}>Go to Upload</Button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100 p-8 text-slate-800">

            {/* Header buttons */}
            <div className="flex items-center justify-between mb-4">
                <Button variant="outline" onClick={() => navigate(-1)} className="bg-white border-slate-300 hover:bg-slate-50 transition-all font-medium">
                    <ArrowLeft className="h-4 w-4 mr-2" /> Back
                </Button>

                <div className="flex gap-2">
                    {!ebData.isViewMode && (
                        <Button onClick={handleSave} className="bg-emerald-600 hover:bg-emerald-700 shadow-md transition-all px-6">
                            <Save className="h-4 w-4 mr-2" /> Save
                        </Button>
                    )}
                </div>
            </div>

            {/* Main Card */}
            <div className="bg-white mx-auto p-12 shadow-2xl border border-slate-200 rounded-sm w-full max-w-7xl min-h-[297mm]">

                <div className="border-b-2 border-slate-100 pb-8 mb-10">
                    <h1 className="text-center font-extrabold text-4xl text-slate-900 tracking-tight uppercase">
                        Energy Allotment Order Charges
                    </h1>
                </div>

                {/* Header Information Section */}
                <div className="mb-12 border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm transition-all hover:shadow-md">
                    <div className="bg-slate-50/80 px-4 py-3 border-b border-slate-200 flex items-center gap-2">
                        <Info className="h-4 w-4 text-blue-600" />
                        <span className="text-sm font-bold text-slate-700 tracking-wide">Header Information</span>
                    </div>
                    <div className="p-8 grid grid-cols-3 divide-x divide-slate-100">
                        {/* Company Name */}
                        <div className="px-4 first:pl-2">
                            <div className="flex items-center gap-2 text-slate-400 mb-1.5">
                                <Building2 className="h-3.5 w-3.5" />
                                <span className="text-[10px] font-bold uppercase tracking-widest">Company Name</span>
                            </div>
                            <div className="text-[13px] font-extrabold text-slate-900 uppercase leading-relaxed">
                                {ebData.customer_name || "-"}
                            </div>
                        </div>

                        {/* Windmill Number */}
                        <div className="px-8">
                            <div className="flex items-center gap-2 text-slate-400 mb-1.5">
                                <Hash className="h-3.5 w-3.5" />
                                <span className="text-[10px] font-bold uppercase tracking-widest">Windmill Number</span>
                            </div>
                            <div className="text-[13px] font-extrabold text-red-800 tracking-wider">
                                {ebData.service_number || "-"}
                            </div>
                        </div>

                        {/* Month / Year */}
                        <div className="px-8 last:pr-2">
                            <div className="flex items-center gap-2 text-slate-400 mb-1.5">
                                <Calendar className="h-3.5 w-3.5" />
                                <span className="text-[10px] font-bold uppercase tracking-widest">Month / Year</span>
                            </div>
                            <div className="text-[13px] font-extrabold text-slate-900 tracking-wider">
                                {ebData.bill_month_name || "-"} / {ebData.bill_year || "-"}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Applicable Charges Section */}
                <div className="mb-8">
                    <h2 className="flex items-center text-lg font-semibold text-gray-800 mb-4">
                        <span className="text-red-600 mr-2">📋</span> Abstract for OA Adjustment Charges
                    </h2>

                    {oaRows.length === 0 ? (
                        <div className="text-center p-12 text-gray-500 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
                            No windmill charges found in the processed data
                        </div>
                    ) : (
                        <div className="border border-gray-300 rounded-xl overflow-hidden shadow-sm">
                            <table className="w-full border-collapse text-[12px]">
                                <thead>
                                    <tr className="bg-[hsl(var(--sidebar-background))]">
                                        <th className="px-3 py-4 text-left font-bold text-white uppercase tracking-wider w-[140px] border-r border-white/10">Windmill</th>
                                        {/* Columns header */}
                                        {columns.slice(1).map((col: string, i: number) => (
                                            <th key={i} className={`px-2 py-4 text-center font-bold text-white uppercase tracking-tighter text-[10px] leading-tight border-r border-white/10 last:border-r-0 ${col === 'Wheeling Charges' ? 'w-[100px]' : ''}`}>
                                                {col}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {oaRows.map((row: any, rowIdx: number) => (
                                        <tr key={rowIdx} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-3 py-3 text-gray-900 font-bold border-r border-gray-300 bg-slate-50/50">{row.windmill}</td>
                                            {columns.slice(1).map((_: string, colIdx: number) => (
                                                <td key={colIdx} className="px-2 py-3 text-right text-gray-900 border-r border-gray-200 last:border-r-0 font-medium">
                                                    {Number(row.charges?.[colIdx] ?? "0").toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                    {/* Total row */}
                                    <tr className="bg-slate-100 font-bold border-t-2 border-[hsl(var(--sidebar-background))]">
                                        <td className="px-3 py-4 text-slate-900 uppercase text-[11px] tracking-widest border-r border-slate-300">Total</td>
                                        {columns.slice(1).map((_: string, colIdx: number) => (
                                            <td key={colIdx} className="px-2 py-4 text-right text-slate-900 border-r border-slate-300 last:border-r-0">
                                                {Number(oaRows.reduce((sum: number, r: any) => {
                                                    return sum + (parseFloat(r.charges?.[colIdx] ?? "0") || 0);
                                                }, 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </td>
                                        ))}
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}