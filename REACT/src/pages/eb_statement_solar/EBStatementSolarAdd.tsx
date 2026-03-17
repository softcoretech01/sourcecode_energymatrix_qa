import React, { useState } from "react";
import { ArrowLeft, Calendar as CalendarIcon, UploadCloud } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { useNavigate } from "react-router-dom";

export default function EBStatementSolarAdd() {
    const navigate = useNavigate();
    const [selectedSolar, setSelectedSolar] = useState("SOL-001");
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);

    const months = [
        { value: "1", label: "January" },
        { value: "2", label: "February" },
        { value: "3", label: "March" },
        { value: "4", label: "April" },
        { value: "5", label: "May" },
        { value: "6", label: "June" },
        { value: "7", label: "July" },
        { value: "8", label: "August" },
        { value: "9", label: "September" },
        { value: "10", label: "October" },
        { value: "11", label: "November" },
        { value: "12", label: "December" },
    ];

    // Mock PDF data for the preview table
    const previewData = [
        {
            id: 1,
            readingDate: "2024-04-18",
            solarNumber: "SOL-001",
            exportedKwh: "1,200",
            consumedKwh: "300",
            unitValueExport: "5",
            netPayable: "4,500",
        },
        {
            id: 2,
            readingDate: "2024-04-19",
            solarNumber: "SOL-002",
            exportedKwh: "1,050",
            consumedKwh: "290",
            unitValueExport: "4.80",
            netPayable: "3,624",
        },
        {
            id: 3,
            readingDate: "2024-04-20",
            solarNumber: "SOL-003",
            exportedKwh: "1,300",
            consumedKwh: "310",
            unitValueExport: "5.20",
            netPayable: "5,096",
        },
    ];

    return (
        <div className="p-2 bg-slate-50 min-h-screen font-sans">
            <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                {/* Header */}
                <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <h1 className="text-lg font-semibold text-indigo-700">
                        EB Statement-Solar - Upload
                    </h1>
                    <div className="flex gap-2">
                        <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white h-8 px-4">
                            Save
                        </Button>
                        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 px-4">
                            Post
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            className="text-slate-600 border-slate-300 bg-white hover:bg-slate-50 h-8 w-8 p-0"
                            onClick={() => navigate("/eb-statement-solar")}
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                <div className="p-4">
                    <div className="space-y-4 px-4 pt-2">
                        {/* Solar and Month Selection */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-600">Solar Number</label>
                                <Select defaultValue="sol-001" onValueChange={setSelectedSolar}>
                                    <SelectTrigger className="w-full border-slate-300 h-9">
                                        <SelectValue placeholder="Select Solar" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="sol-001">SOL-001</SelectItem>
                                        <SelectItem value="sol-002">SOL-002</SelectItem>
                                        <SelectItem value="sol-003">SOL-003</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-600">Month</label>
                                <Select>
                                    <SelectTrigger className="w-full border-slate-300 h-9">
                                        <SelectValue placeholder="Select Month" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {months.map((m) => (
                                            <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Upload Area */}
                        <div
                            onClick={() => document.getElementById("solar-file-input")?.click()}
                            className="bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:bg-slate-100 transition-colors cursor-pointer"
                        >
                            <UploadCloud className="h-12 w-12 text-blue-400 mx-auto mb-2" />
                            <p className="text-sm font-medium text-slate-700">
                                Drop PDF file here or <span className="text-blue-600">click to upload</span>
                                <input
                                    id="solar-file-input"
                                    type="file"
                                    accept="application/pdf"
                                    className="hidden"
                                    onChange={(e) => {
                                        const f = e.target.files?.[0];
                                        if (!f) return;
                                        if (f.type !== "application/pdf") {
                                            alert("Only PDF files allowed");
                                            return;
                                        }
                                        setSelectedFile(f);
                                    }}
                                />
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                                (Only PDF files, max 10 MB)
                            </p>

                            {selectedFile && (
                                <p className="text-green-600 text-sm mt-3">Selected: {selectedFile.name}</p>
                            )}
                        </div>

                        <div className="flex justify-center">
                            <Button
                                className="bg-blue-600 hover:bg-blue-700 text-white"
                                onClick={async () => {
                                    if (!selectedFile) {
                                        alert("Please select a PDF first");
                                        return;
                                    }

                                    setLoading(true);

                                    const formData = new FormData();
                                    formData.append("file", selectedFile);
                                    formData.append("solar_number", selectedSolar);

                                    try {
                                        const res = await fetch(`${BACKEND_API_URL}/eb-solar/read-pdf`, {
                                            method: "POST",
                                            body: formData,
                                        });

                                        if (!res.ok) throw new Error("Upload failed");

                                        const data = await res.json();

                                        if (data.filename) {
                                            sessionStorage.setItem("ebStatementSolarFile", data.filename);
                                            if (data.parsed) {
                                                sessionStorage.setItem("ebStatementSolarData", JSON.stringify(data.parsed));
                                            }
                                            navigate("/eb-statement-solar/pdf");
                                        } else {
                                            alert(data.message || "Upload failed");
                                        }
                                    } catch (err) {
                                        console.error(err);
                                        alert("Upload failed. Check backend.");
                                    } finally {
                                        setLoading(false);
                                    }
                                }}
                                disabled={loading}
                            >
                                {loading ? "Reading PDF..." : "Upload and Read PDF"}
                            </Button>
                        </div>



                    </div>
                </div>
            </div>
        </div>
    );
}
