import React, { useState, useEffect, useRef } from "react";
import { ArrowLeft, Calendar as CalendarIcon, UploadCloud, FileText, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
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
import { useNavigate } from "react-router-dom";
import api from "@/services/api";
import { toast } from "sonner";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function ActualsAdd() {
    const navigate = useNavigate();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [windmills, setWindmills] = useState<any[]>([]);
    const [selectedWindmill, setSelectedWindmill] = useState<string>("");
    const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
    const [selectedMonth, setSelectedMonth] = useState<string>("");
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [mismatchError, setMismatchError] = useState<{
        isOpen: boolean;
        title: string;
        description: string;
    }>({ isOpen: false, title: "", description: "" });

    useEffect(() => {
        const fetchWindmills = async () => {
            try {
                setLoading(true);
                const res = await api.get("/windmills");
                if (Array.isArray(res.data)) {
                    setWindmills(res.data);
                }
            } catch (err) {
                console.error("Failed to load windmills", err);
                toast.error("Failed to load windmills");
            } finally {
                setLoading(false);
            }
        };

        fetchWindmills();
    }, []);

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

    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            if (file.type !== "application/pdf") {
                toast.error("Please select a PDF file");
                return;
            }
            setSelectedFile(file);
        }
    };

    const handleUpload = async () => {
        if (!selectedWindmill || !selectedYear || !selectedMonth || !selectedFile) {
            toast.error("Please fill all fields and select a file");
            return;
        }

        const windmill = windmills.find(w => w.windmill_number === selectedWindmill);
        if (!windmill) return;

        const formData = new FormData();
        formData.append("windmill_id", windmill.id.toString());
        formData.append("year", selectedYear);
        formData.append("month", selectedMonth);
        formData.append("file", selectedFile);

        try {
            setUploading(true);
            const res = await api.post("/actuals/upload", formData);

            if (res.status === 200) {
                toast.success(`Success: Processed ${res.data.parsed_count} records from ${selectedFile.name}`);
                setTimeout(() => {
                    navigate("/windmill/actuals");
                }, 1500);
            }
        } catch (err: any) {
            console.error("Upload failed", err);
            // If it's a validation mismatch (HTTP 400), show the descriptive Alert Dialog
            if (err.response?.status === 400) {
                setMismatchError({
                    isOpen: true,
                    title: "Validation Mismatch",
                    description: err.response?.data?.detail || "The uploaded PDF does not match the selected details."
                });
            } else {
                toast.error(err.response?.data?.detail || "Upload failed. Please try again.");
            }
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="p-2 bg-slate-50 min-h-screen font-sans">
            <div className="max-w-7xl mx-auto bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                {/* Header */}
                <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <h1 className="text-lg font-semibold text-indigo-700">
                        Actual Allotment - Add
                    </h1>
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            className="text-slate-600 border-slate-300 bg-white hover:bg-slate-50 h-8 w-8 p-0"
                            onClick={() => navigate("/windmill/actuals")}
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                <div className="p-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                        <div className="space-y-1">
                            <label className="text-sm font-semibold text-slate-700">Windmill Number</label>
                            <Select value={selectedWindmill} onValueChange={setSelectedWindmill}>
                                <SelectTrigger className="w-full border-slate-300">
                                    <SelectValue placeholder={loading ? "Loading..." : "Select Windmill"} />
                                </SelectTrigger>
                                <SelectContent>
                                    {windmills.map((wm) => (
                                        <SelectItem key={wm.id} value={wm.windmill_number}>
                                            {wm.windmill_number}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-semibold text-slate-700">Year</label>
                            <Select value={selectedYear} onValueChange={setSelectedYear}>
                                <SelectTrigger className="w-full border-slate-300">
                                    <SelectValue placeholder="Select Year" />
                                </SelectTrigger>
                                <SelectContent>
                                    {years.map((year) => (
                                        <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-semibold text-slate-700">Month</label>
                            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                                <SelectTrigger className="w-full border-slate-300">
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
                        className={`border-2 border-dashed rounded-xl p-12 text-center transition-all ${selectedFile
                                ? "bg-emerald-50 border-emerald-300"
                                : "bg-slate-50 border-slate-300 hover:border-blue-400 hover:bg-slate-100"
                            }`}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            accept=".pdf"
                            onChange={handleFileChange}
                        />

                        {selectedFile ? (
                            <div className="space-y-3">
                                <div className="p-3 bg-emerald-100 w-fit mx-auto rounded-full shadow-inner">
                                    <FileText className="h-10 w-10 text-emerald-600" />
                                </div>
                                <div>
                                    <p className="text font-semibold text-emerald-800">{selectedFile.name}</p>
                                    <p className="text-xs text-emerald-600 font-medium">Ready for upload ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)</p>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-xs h-7 border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedFile(null);
                                    }}
                                >
                                    Change File
                                </Button>
                            </div>
                        ) : (
                            <>
                                <UploadCloud className="h-16 w-16 text-slate-400 mx-auto mb-4" />
                                <h3 className="text-lg font-semibold text-slate-700">Select Energy Adjusted Report</h3>
                                <p className="text-sm text-slate-500 max-w-sm mx-auto mt-2">
                                    Download the PDF report and upload it here. We'll automatically extract the consumer numbers and allotment totals.
                                </p>
                                <div className="mt-6">
                                    <span className="px-4 py-2 bg-white border border-slate-200 rounded-md text-sm font-medium text-slate-700 shadow-sm hover:shadow-md transition-shadow">
                                        Browse Files
                                    </span>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="mt-8 flex justify-center">
                        <Button
                            className={`min-w-[200px] h-12 text-lg shadow-lg transition-all ${uploading ? "bg-slate-400 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700 active:scale-95"
                                }`}
                            disabled={!selectedFile || uploading}
                            onClick={handleUpload}
                        >
                            {uploading ? (
                                <>
                                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                    Processing PDF...
                                </>
                            ) : (
                                "Process & Save Allotments"
                            )}
                        </Button>
                    </div>

                    {/* Info Card */}
                    <div className="mt-12 bg-blue-50 border border-blue-100 rounded-lg p-4 flex gap-4 items-start">
                        <AlertCircle className="h-5 w-5 text-blue-500 mt-0.5" />
                        <div className="text-sm text-blue-800 space-y-1">
                            <p className="font-semibold text-blue-900">Important Note:</p>
                            <p>Ensure you select the correct **Windmill, Year, and Month** before uploading. The system will map individual records based on the **Consumer Number** found in the PDF.</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Validation Mismatch Alert Dialog */}
            <AlertDialog
                open={mismatchError.isOpen}
                onOpenChange={(open) => setMismatchError(prev => ({ ...prev, isOpen: open }))}
            >
                <AlertDialogContent className="max-w-md bg-white border-2 border-rose-100 shadow-2xl rounded-2xl">
                    <AlertDialogHeader className="space-y-3">
                        <div className="mx-auto bg-rose-50 p-3 rounded-full w-fit">
                            <AlertCircle className="h-8 w-8 text-rose-500" />
                        </div>
                        <AlertDialogTitle className="text-xl font-bold text-slate-900 text-center">
                            {mismatchError.title}
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-600 text-center text-sm leading-relaxed pb-2">
                            {mismatchError.description}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="sm:justify-center border-t border-slate-50 pt-4">
                        <AlertDialogAction
                            className="bg-slate-900 hover:bg-slate-800 text-white min-w-[120px] rounded-xl h-10 font-semibold transition-all active:scale-95"
                        >
                            Okay, I'll check
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
