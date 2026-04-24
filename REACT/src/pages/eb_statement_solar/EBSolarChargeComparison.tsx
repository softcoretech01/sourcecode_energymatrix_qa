import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import api from "@/services/api";
import { ArrowLeft, Loader2, Calculator, TrendingDown, TrendingUp, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

interface ComparisonData {
    solar_id: number;
    charge_id: number;
    charge_name?: string;
    calculated_value: number;
    total_charge: number;
    difference: number;
    calculation?: string;
}

const EBSolarChargeComparison = () => {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<ComparisonData[]>([]);

    const headerId = params.get("id");

    const fetchComparison = async () => {
        if (!headerId) {
            toast.error("Missing Solar EB Header ID");
            return;
        }

        setLoading(true);
        setError(null);
        try {
            // Using the NEW SOLAR API endpoint
            const res = await api.get(`/charges-solar/compare-charges?eb_header_id=${headerId}`);
            if (res.data.success) {
                setData(res.data.data);
                toast.success("Solar comparison data updated");
            } else {
                setError(res.data.message || "Failed to fetch solar comparison data");
                toast.error("Failed to fetch solar comparison data");
            }
        } catch (err: any) {
            console.error("Error fetching solar comparison:", err);
            const errMsg = err.response?.data?.detail || err.message || "Error fetching solar comparison data";
            setError(errMsg);
            toast.error(errMsg);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchComparison();
    }, [headerId]);

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="ml-2 text-lg">Analyzing Charges...</span>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 p-6">
            <div className="mx-auto max-w-6xl space-y-6">
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                        <Button variant="ghost" onClick={() => navigate(-1)}>
                            <ArrowLeft className="mr-2 h-4 w-4" /> Back
                        </Button>
                        <h1 className="text-2xl font-bold text-slate-900">Solar Charge Comparison Analysis</h1>
                    </div>
                </div>

                {error && (
                    <Card className="border-red-200 bg-red-50">
                        <CardContent className="flex items-center p-4">
                            <Info className="mr-2 h-5 w-5 text-red-600" />
                            <span className="text-red-800 font-medium">Error: {error}</span>
                        </CardContent>
                    </Card>
                )}

                <Card className="border-none shadow-sm overflow-hidden">
                    <CardHeader className="bg-slate-100/50 pb-4">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-lg flex items-center">
                                <Calculator className="mr-2 h-5 w-5 text-blue-600" />
                                Comparison Details (Solar)
                            </CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                                        <TableHead className="font-bold py-4">Charge</TableHead>
                                        <TableHead className="font-bold py-4">Formula Breakdown</TableHead>
                                        <TableHead className="font-bold text-right py-4">Statement Charge (₹)</TableHead>
                                        <TableHead className="font-bold text-right py-4">Calculated Value (₹)</TableHead>
                                        <TableHead className="font-bold text-right py-4">Difference (₹)</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {data.length > 0 ? (
                                        data
                                            .filter(row => {
                                                const name = (row.charge_name || "").toUpperCase();
                                                return !name.includes("WHEELING CHARGE") && !name.includes("SELF GENERATION TAX");
                                            })
                                            .map((row, idx) => {
                                                const isMismatch = Math.abs(row.difference) > 0.01;
                                                return (
                                                    <TableRow 
                                                        key={`${row.solar_id}-${row.charge_id}-${idx}`}
                                                        className={`hover:bg-slate-50/50 transition-colors ${isMismatch ? 'bg-red-50/10' : 'bg-green-50/10'}`}
                                                    >
                                                    <TableCell className="font-medium text-slate-700 py-4">
                                                        <span className="text-sm font-semibold text-slate-700 truncate max-w-[200px]" title={row.charge_name}>
                                                            {row.charge_name || `Charge ${row.charge_id}`}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="py-4">
                                                        <span className="text-xs text-slate-500 font-mono italic">
                                                            {row.calculation || "N/A"}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-right font-semibold text-slate-700 tabular-nums">
                                                        ₹ {row.total_charge.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                    </TableCell>
                                                    <TableCell className="text-right font-semibold text-blue-700 tabular-nums">
                                                        ₹ {row.calculated_value.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                    </TableCell>
                                                    <TableCell className={`text-right font-bold tabular-nums ${isMismatch ? 'text-red-600' : 'text-green-600'}`}>
                                                        <div className="flex items-center justify-end">
                                                            {isMismatch ? (
                                                                row.difference > 0 ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />
                                                            ) : null}
                                                            {row.difference > 0 ? '+' : ''}{row.difference.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center py-20 text-slate-400">
                                                <div className="flex flex-col items-center">
                                                    <Info className="h-10 w-10 mb-2 opacity-20" />
                                                    <p className="italic">No comparison data found for this solar statement.</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default EBSolarChargeComparison;
