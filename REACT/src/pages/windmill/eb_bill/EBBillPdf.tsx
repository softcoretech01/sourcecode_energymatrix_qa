import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileDiff, Save } from "lucide-react";
import { useNavigate } from "react-router-dom";
import api from "@/services/api";

export default function EBBillPdf() {
    const navigate = useNavigate();
    const [ebData, setEbData] = useState<any>(null);

    const oaRows = ebData?.matched_rows || [];
    const columns = ebData?.columns || [];

    useEffect(() => {
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
        <div className="min-h-screen bg-gray-100 p-8">

            {/* Header buttons */}
            <div className="flex items-center justify-between mb-4">
                <Button variant="outline" onClick={() => navigate(-1)} className="bg-white">
                    <ArrowLeft className="h-4 w-4 mr-2" /> Back
                </Button>

                <div className="flex gap-2">
                    {!ebData.isViewMode && (
                        <>
                            <Button onClick={handleSave} className="bg-emerald-600 hover:bg-emerald-700">
                                <Save className="h-4 w-4 mr-2" /> Save
                            </Button>

                            <Button>
                                <FileDiff className="h-4 w-4 mr-2" /> Comparison
                            </Button>
                        </>
                    )}
                </div>
            </div>

            {/* Main Card */}
            <div className="bg-white mx-auto p-10 shadow-xl border border-gray-200 rounded-sm w-full max-w-7xl min-h-[297mm]">

                <div className="border-b-2 border-gray-100 pb-6 mb-8">
                    <h1 className="text-center font-bold text-3xl text-gray-900 tracking-tight">
                        ENERGY ALLOTMENT ORDER CHARGES
                    </h1>
                </div>

                {/* Customer Details Box */}
                {ebData && (
                    <div className="mb-10 text-base grid grid-cols-2 gap-y-4 gap-x-12 border border-gray-200 p-6 rounded-lg bg-gray-50/30">
                        <div className="flex items-center gap-3">
                            <span className="font-bold text-gray-500 uppercase text-[12px] tracking-wider w-32">Customer:</span>
                            <span className="font-semibold text-gray-900">{ebData.customer_name || "-"}</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="font-bold text-gray-500 uppercase text-[12px] tracking-wider w-32">Service No:</span>
                            <span className="font-mono font-medium text-gray-900">{ebData.service_number || "-"}</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="font-bold text-gray-500 uppercase text-[12px] tracking-wider w-32">Year / Month:</span>
                            <span className="font-semibold text-gray-900">
                                {ebData.bill_year || "-"} / {ebData.bill_month_name || "-"}
                            </span>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="font-bold text-gray-500 uppercase text-[12px] tracking-wider w-32">Self Gen Tax:</span>
                            <span className="font-bold text-emerald-700">₹ {Number(ebData.self_generation_tax || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                        </div>
                    </div>
                )}

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
                                    <tr className="bg-slate-800">
                                        <th className="px-3 py-4 text-left font-bold text-white uppercase tracking-wider w-[140px] border-r border-slate-700">Windmill</th>
                                        {/* Columns header */}
                                        {columns.slice(1).map((col: string, i: number) => (
                                            <th key={i} className={`px-2 py-4 text-center font-bold text-white uppercase tracking-tighter text-[10px] leading-tight border-r border-slate-700 last:border-r-0 ${col === 'Wheeling Charges' ? 'w-[100px]' : ''}`}>
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
                                    <tr className="bg-slate-100 font-bold border-t-2 border-slate-800">
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