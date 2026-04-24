import React, { useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, Printer } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import api from "@/services/api";
import { toast } from "sonner";

export default function ActualsReconcile() {
    const navigate = useNavigate();
    const { id } = useParams();
    const [loading, setLoading] = useState(true);
    const [reconcileDetails, setReconcileDetails] = useState<any>(null);

    useEffect(() => {
        if (id) {
            fetchReconciliationDetails();
        }
    }, [id]);

    const fetchReconciliationDetails = async () => {
        setLoading(true);
        try {
            const res = await api.get(`/actuals/reconciliation/${id}`);
            setReconcileDetails(res.data);
        } catch (err) {
            console.error("Failed to fetch reconciliation details", err);
            toast.error("Failed to load reconciliation details");
        } finally {
            setLoading(false);
        }
    };

    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans">
            {/* Top Buttons */}
            <div className="mb-6 flex justify-between items-center no-print max-w-4xl mx-auto">
                <Button
                    variant="outline"
                    onClick={() => navigate(-1)}
                    className="flex items-center gap-2 bg-white"
                >
                    <ArrowLeft className="h-4 w-4" /> Back to List
                </Button>
                <Button
                    onClick={handlePrint}
                    className="flex items-center gap-2 bg-sidebar hover:bg-sidebar/90 text-white"
                >
                    <Printer className="h-4 w-4" /> Print
                </Button>
            </div>

            {/* Content Container */}
            <div className="bg-white mx-auto p-6 md:p-10 shadow-xl rounded-xl border border-slate-200 max-w-4xl min-h-[70vh]">
                <div className="flex items-center gap-3 mb-8 border-b border-slate-100 pb-4">
                    <div className="p-2 bg-blue-50 rounded-lg">
                        <FileText className="h-6 w-6 text-blue-600" />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-800">
                        Auto Reconciled Summary
                    </h1>
                </div>

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-24 text-slate-400">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mb-4"></div>
                        <p className="font-medium">Fetching reconciliation details...</p>
                    </div>
                ) : reconcileDetails ? (
                    <div className="space-y-8 animate-in fade-in duration-500">
                        {/* Header Info Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
                                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none mb-2 block">Customer</span>
                                <span className="text-sm font-bold text-slate-800">{reconcileDetails.customer_name}</span>
                            </div>
                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
                                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none mb-2 block">SC Number</span>
                                <span className="text-sm font-bold text-slate-800">{reconcileDetails.service_number}</span>
                            </div>
                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
                                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none mb-2 block">Billing Period</span>
                                <span className="text-sm font-bold text-slate-800">{reconcileDetails.month} {reconcileDetails.year}</span>
                            </div>
                        </div>

                        {/* Reconciliation Table */}
                        <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-sidebar text-white">
                                    <tr>
                                        <th className="px-6 py-4 font-semibold tracking-wide uppercase text-[11px]">Windmill</th>
                                        <th className="px-6 py-4 font-semibold tracking-wide uppercase text-[11px] text-right">System Charge (₹)</th>
                                        <th className="px-6 py-4 font-semibold tracking-wide uppercase text-[11px] text-right">Manual Adjusted (₹)</th>
                                        <th className="px-6 py-4 font-semibold tracking-wide uppercase text-[11px] text-center">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {reconcileDetails.details.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} className="text-center py-12 text-slate-500 font-medium">
                                                No windmill charges mapped for this customer.
                                            </td>
                                        </tr>
                                    ) : (
                                        reconcileDetails.details.map((item: any, idx: number) => (
                                            <tr key={idx} className="hover:bg-slate-50 transition-colors">
                                                <td className="px-6 py-4 font-bold text-slate-700">{item.windmill}</td>
                                                <td className="px-6 py-4 text-right tabular-nums font-medium">
                                                    {Number(item.system_wheeling_charge).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                                                </td>
                                                <td className="px-6 py-4 text-right tabular-nums font-medium">
                                                    {Number(item.manual_adjusted_total).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                                        item.status === 'Matched' 
                                                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                                                            : 'bg-rose-100 text-rose-800 border border-rose-200'
                                                    }`}>
                                                        {item.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                    
                                    {/* Totals Row */}
                                    {reconcileDetails.details.length > 0 && (
                                        <tr className="bg-slate-50 font-bold border-t-2 border-slate-200">
                                            <td className="px-6 py-4 text-slate-900 border-r border-slate-200">Total</td>
                                            <td className="px-6 py-4 text-right text-slate-900 tabular-nums text-base">
                                                {Number(reconcileDetails.details.reduce((sum: number, i: any) => sum + i.system_wheeling_charge, 0)).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                                            </td>
                                            <td className="px-6 py-4 text-right text-slate-900 tabular-nums text-base">
                                                {Number(reconcileDetails.details.reduce((sum: number, i: any) => sum + i.manual_adjusted_total, 0)).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                                            </td>
                                            <td className="px-6 py-4"></td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                    </div>
                ) : (
                    <div className="py-12 text-center text-rose-500 font-bold bg-rose-50 rounded-lg border border-rose-100">
                        No reconciliation details available for this record.
                    </div>
                )}
            </div>
            
            <style>
                {`
                @media print {
                    .no-print {
                        display: none !important;
                    }
                    body {
                        background: white !important;
                        padding: 0 !important;
                    }
                    .shadow-xl {
                        box-shadow: none !important;
                    }
                    .border {
                        border-color: #e2e8f0 !important;
                    }
                }
                `}
            </style>
        </div>
    );
}
