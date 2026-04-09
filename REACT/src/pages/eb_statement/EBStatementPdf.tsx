import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import api from "../../services/api";
import { FileText, ArrowLeft, Loader2, Hash, Info, Briefcase, Zap, Calculator, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

const EBStatementPdf = () => {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);
    const [headerId, setHeaderId] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        const fetchMetadata = async () => {
            const filename = params.get("file") || sessionStorage.getItem("ebStatementFile");
            if (!filename) {
                toast.error("No file specified");
                setLoading(false);
                return;
            }

            // 1. Try sessionStorage first (fastest - written by upload page)
            const storedHeaderId = sessionStorage.getItem("ebStatementHeaderId");
            const storedParsed = sessionStorage.getItem("ebStatementParsedData");

            if (storedHeaderId) {
                const hId = parseInt(storedHeaderId, 10);
                if (!Number.isNaN(hId) && hId > 0) {
                    setHeaderId(hId);
                }
            }
            if (storedParsed) {
                try {
                    setData(JSON.parse(storedParsed));
                } catch { /* ignore */ }
            }

            // 2. Always also call read-metadata to get full data / check if already saved
            try {
                const res = await api.get(`/eb/read-metadata?filename=${filename}`);
                if (res.data.status === "success") {
                    const hId = res.data.header_id;
                    if (hId) {
                        setHeaderId(hId);
                        sessionStorage.setItem("ebStatementHeaderId", String(hId));
                    }

                    if (hId) {
                        try {
                            const detailsRes = await api.get(`/eb/details/${hId}`);
                            if (detailsRes.data.status === "success") {
                                const dbData = detailsRes.data.data || {};
                                const extData = res.data.data || {};
                                const mergedCharges = (dbData.charges || []).map((dbC: any, idx: number) => ({
                                    ...dbC,
                                    name: dbC.name || extData.charges?.[idx]?.name || "Other Charge"
                                }));
                                setData({
                                    ...extData,
                                    ...dbData,
                                    charges: mergedCharges.length > 0 ? mergedCharges : extData.charges,
                                    company_name: extData.company_name,
                                    windmill_number: extData.windmill_number,
                                    month: extData.month || dbData.month,
                                    year: extData.year || dbData.year
                                });
                                setSaved(true);
                            } else if (!storedParsed) {
                                setData(res.data.data);
                            }
                        } catch {
                            if (!storedParsed) setData(res.data.data);
                        }
                    } else if (!storedParsed) {
                        setData(res.data.data);
                    }
                }
            } catch (err) {
                console.warn("read-metadata call failed, using sessionStorage data:", err);
                if (!storedParsed && !storedHeaderId) {
                    toast.error("Error reading statement data. Please re-upload.");
                }
            } finally {
                setLoading(false);
            }
        };

        fetchMetadata();
    }, [params]);

    const handleSave = async () => {
        if (!headerId || !data) {
            toast.error("Required data missing");
            return;
        }

        setSaving(true);
        try {
            // Extract windmill_id from filename (format: {windmill_id}_{month}_{uuid}.pdf)
            const filename = params.get("file") || sessionStorage.getItem("ebStatementFile");
            const windmillId = filename ? parseInt(filename.split("_")[0]) : 0;

            const payload = {
                eb_header_id: headerId,
                company_name: data.company_name,
                windmill_id: windmillId,
                slots: data.slots,
                banking_slots: data.banking_slots,
                banking_units: parseFloat(data.banking_units || 0),
                charges: data.charges.map((c: any) => ({
                    name: c.name,
                    amount: parseFloat(c.amount || 0),
                    code: c.code || null
                }))
            };

            const res = await api.post("/eb/save-details", payload);
            if (res.data.status === "success") {
                toast.success("Details saved successfully");
                setSaved(true);
            } else {
                toast.error(res.data.message || "Failed to save details");
            }
        } catch (err: any) {
            console.error(err);
            toast.error(err.response?.data?.detail || "Error saving details");
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="ml-2 text-lg">Reading Statement...</span>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="flex h-screen flex-col items-center justify-center space-y-4">
                <FileText className="h-12 w-12 text-muted-foreground" />
                <h2 className="text-xl font-semibold">Statement data not found</h2>
                <Button onClick={() => navigate("/eb-statement")}>Go Back</Button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 p-6">
            <div className="mx-auto max-w-5xl space-y-6">
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                        <Button variant="ghost" onClick={() => navigate("/eb-statement") }>
                            <ArrowLeft className="mr-2 h-4 w-4" /> Back
                        </Button>
                        <h1 className="text-2xl font-bold text-slate-900">EB Statement Data</h1>
                    </div>
                    <Button 
                        onClick={handleSave} 
                        disabled={saving || saved || !headerId}
                        className={saved ? "bg-green-600 hover:bg-green-700" : "bg-blue-600 hover:bg-blue-700"}
                    >
                        {saving ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Saving...
                            </>
                        ) : saved ? (
                            "Saved"
                        ) : (
                            "Save Statement"
                        )}
                    </Button>
                </div>

                <div className="grid gap-6 md:grid-cols-1">
                    {/* Header Info */}
                    <Card className="border-none shadow-sm">
                        <CardHeader className="flex flex-row items-center space-x-2 bg-slate-100/50 pb-2">
                            <Info className="h-5 w-5 text-blue-600" />
                            <CardTitle className="text-lg">Header Information</CardTitle>
                        </CardHeader>
                        <CardContent className="pt-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="flex flex-col space-y-1">
                                    <span className="flex items-center text-xs font-medium text-slate-500 uppercase tracking-wider">
                                        <Briefcase className="mr-2 h-3.5 w-3.5" /> Company Name
                                    </span>
                                    <span className="text-sm font-bold text-slate-800 break-words">{data.company_name || "N/A"}</span>
                                </div>
                                <div className="flex flex-col space-y-1 md:border-x md:px-6">
                                    <span className="flex items-center text-xs font-medium text-slate-500 uppercase tracking-wider">
                                        <Hash className="mr-2 h-3.5 w-3.5" /> Windmill Number
                                    </span>
                                    <span className="text-sm font-bold font-mono" style={{ color: 'firebrick' }}>{data.windmill_number || "N/A"}</span>
                                </div>
                                <div className="flex flex-col space-y-1">
                                    <span className="flex items-center text-xs font-medium text-slate-500 uppercase tracking-wider">
                                        <Calendar className="mr-2 h-3.5 w-3.5" /> Month / Year
                                    </span>
                                    <span className="text-sm font-bold text-slate-800">
                                        {(data.month && data.month !== "None") ? data.month : "N/A"} / {(data.year && data.year !== "None") ? data.year : "N/A"}
                                    </span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Net Units Table */}
                <Card className="border-none shadow-sm">
                    <CardHeader className="flex flex-row items-center space-x-2 bg-slate-100/50 pb-2">
                        <Zap className="h-5 w-5 text-green-600" />
                        <CardTitle className="text-lg">Slot Wise Net Generation</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-slate-50">
                                    <TableHead className="font-bold text-center">C1</TableHead>
                                    <TableHead className="font-bold text-center">C2</TableHead>
                                    <TableHead className="font-bold text-center">C4</TableHead>
                                    <TableHead className="font-bold text-center">C5</TableHead>
                                    <TableHead className="font-bold text-right pr-4">Total Net</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                <TableRow className="hover:bg-slate-50/50">
                                    <TableCell className="text-center font-medium">{data.slots?.C1 || "0"}</TableCell>
                                    <TableCell className="text-center font-medium">{data.slots?.C2 || "0"}</TableCell>
                                    <TableCell className="text-center font-medium">{data.slots?.C4 || "0"}</TableCell>
                                    <TableCell className="text-center font-medium">{data.slots?.C5 || "0"}</TableCell>
                                    <TableCell className="text-right pr-4 font-bold text-green-700">
                                        {(parseFloat(data.slots?.C1 || 0) + 
                                          parseFloat(data.slots?.C2 || 0) + 
                                          parseFloat(data.slots?.C4 || 0) + 
                                          parseFloat(data.slots?.C5 || 0)).toLocaleString()}
                                    </TableCell>
                                </TableRow>
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                {/* Banking Units Table */}
                <Card className="border-none shadow-sm">
                    <CardHeader className="flex flex-row items-center space-x-2 bg-slate-100/50 pb-2">
                        <Calculator className="h-5 w-5 text-amber-500" />
                        <CardTitle className="text-lg">Slot Wise Banking Units</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-slate-50">
                                    <TableHead className="font-bold text-center">C1</TableHead>
                                    <TableHead className="font-bold text-center">C2</TableHead>
                                    <TableHead className="font-bold text-center">C4</TableHead>
                                    <TableHead className="font-bold text-center">C5</TableHead>
                                    <TableHead className="font-bold text-right pr-4">Total Banking</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                <TableRow className="hover:bg-slate-50/50">
                                    <TableCell className="text-center font-medium">{data.banking_slots?.C1 || "0"}</TableCell>
                                    <TableCell className="text-center font-medium">{data.banking_slots?.C2 || "0"}</TableCell>
                                    <TableCell className="text-center font-medium">{data.banking_slots?.C4 || "0"}</TableCell>
                                    <TableCell className="text-center font-medium">{data.banking_slots?.C5 || "0"}</TableCell>
                                    <TableCell className="text-right pr-4 font-bold text-amber-700">
                                        {parseFloat(data.banking_units || 0).toLocaleString()}
                                    </TableCell>
                                </TableRow>
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                {/* Charges Table */}
                <Card className="border-none shadow-sm">
                    <CardHeader className="flex flex-row items-center space-x-2 bg-slate-100/50 pb-2">
                        <Calculator className="h-5 w-5 text-red-600" />
                        <CardTitle className="text-lg">Applicable Charges</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4 p-0">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-slate-50">
                                    <TableHead className="pl-6">Charge Description</TableHead>
                                    <TableHead className="text-right pr-6">Amount (₹)</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {data.charges && data.charges.length > 0 ? (
                                    data.charges.map((charge: any, idx: number) => (
                                        <TableRow key={idx} className="hover:bg-slate-50/50 border-b">
                                            <TableCell className="pl-6 font-medium text-slate-700">{charge.name}</TableCell>
                                            <TableCell className="text-right pr-6 font-semibold text-red-600 tabular-nums">
                                                {parseFloat(charge.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={2} className="text-center py-8 text-slate-400 italic">
                                            No explicit charges found in the statement summary.
                                        </TableCell>
                                    </TableRow>
                                )}
                                {data.charges && data.charges.length > 0 && (
                                    <TableRow className="bg-slate-50 font-bold border-t-2">
                                        <TableCell className="pl-6">Total Charges</TableCell>
                                        <TableCell className="text-right pr-6 text-lg text-red-700">
                                            ₹ {data.charges.reduce((acc: number, c: any) => acc + parseFloat(c.amount), 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default EBStatementPdf;