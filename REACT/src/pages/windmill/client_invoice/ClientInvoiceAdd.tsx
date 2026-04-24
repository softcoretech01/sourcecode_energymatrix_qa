import React, { useEffect, useState } from "react";
import { ArrowLeft, ReceiptText, FileCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
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

interface Customer {
    id: number;
    customer_name: string;
}

interface ServiceNumber {
    id: number;
    service_number: string;
}

export default function ClientInvoiceAdd() {
    const navigate = useNavigate();
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [serviceNumbers, setServiceNumbers] = useState<ServiceNumber[]>([]);

    const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
    const [selectedServiceId, setSelectedServiceId] = useState<string>("");
    const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const monthsNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const now = new Date();
        const prevMonthIdx = now.getMonth() - 1;
        return prevMonthIdx >= 0 ? monthsNames[prevMonthIdx] : "January";
    });

    const [generating, setGenerating] = useState(false);

    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

    const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    useEffect(() => {
        fetchCustomers();
    }, []);

    const fetchCustomers = async () => {
        try {
            const response = await api.get("/customers");
            setCustomers(response.data);
        } catch (error) {
            console.error("Error fetching customers:", error);
            toast.error("Failed to fetch customers");
        }
    };

    const fetchServiceNumbers = async (customerId: string) => {
        try {
            const response = await api.get(`/customers/${customerId}/se`);
            setServiceNumbers(response.data);
        } catch (error) {
            console.error("Error fetching service numbers:", error);
            toast.error("Failed to fetch service numbers");
        }
    };

    const handleCustomerChange = (id: string) => {
        setSelectedCustomerId(id);
        setSelectedServiceId("");
        fetchServiceNumbers(id);
    };

    const handleGenerateInvoice = async () => {
        if (!selectedCustomerId || !selectedServiceId || !selectedMonth || !selectedYear) {
            toast.error("Please fill all fields before generating");
            return;
        }

        setGenerating(true);
        try {
            const res = await api.post("/invoices/generate", {
                customer_id: selectedCustomerId,
                service_id: selectedServiceId,
                year: selectedYear,
                month: selectedMonth,
            });

            toast.success("Invoice generated successfully!");
            navigate(`/windmill/client-invoice/pdf/${res.data.invoice_id}`);
        } catch (error: any) {
            console.error("Error generating invoice:", error);
            toast.error(error?.response?.data?.detail || "Failed to generate invoice");
        } finally {
            setGenerating(false);
        }
    };

    return (
        <div className="p-2 bg-slate-50 min-h-screen font-sans">
            <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">

                {/* Header */}
                <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <h1 className="text-lg font-semibold text-indigo-700">
                        Client Invoice - Add
                    </h1>
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            className="bg-blue-600 hover:bg-blue-700 text-white h-8 px-4 flex items-center gap-2"
                            onClick={handleGenerateInvoice}
                            disabled={generating}
                        >
                            <ReceiptText className="h-4 w-4" />
                            {generating ? "Generating..." : "Generate Invoice"}
                        </Button>

                        <Button
                            size="sm"
                            variant="outline"
                            className="text-slate-600 border-slate-300 bg-white hover:bg-slate-50 h-8 w-8 p-0"
                            onClick={() => navigate("/windmill/client-invoice")}
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                <div className="p-6">
                    <div className="space-y-6">

                        {/* Dropdowns Row */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            {/* Customer Name */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                                    Customer Name
                                </label>
                                <Select value={selectedCustomerId} onValueChange={handleCustomerChange}>
                                    <SelectTrigger className="w-full border-slate-300 h-10 shadow-sm">
                                        <SelectValue placeholder="Select Customer" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {customers.map((c) => (
                                            <SelectItem key={c.id} value={c.id.toString()}>
                                                {c.customer_name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Service Number */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                                    Service Number
                                </label>
                                <Select
                                    value={selectedServiceId}
                                    onValueChange={setSelectedServiceId}
                                    disabled={!selectedCustomerId}
                                >
                                    <SelectTrigger className="w-full border-slate-300 h-10 shadow-sm">
                                        <SelectValue placeholder={selectedCustomerId ? "Select Service #" : "Choose Customer First"} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {serviceNumbers.map((sn) => (
                                            <SelectItem key={sn.id} value={sn.id.toString()}>
                                                {sn.service_number}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Year Selection */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                                    Year
                                </label>
                                <Select value={selectedYear} onValueChange={setSelectedYear}>
                                    <SelectTrigger className="w-full border-slate-300 h-10 shadow-sm">
                                        <SelectValue placeholder="Select Year" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {years.map((y) => (
                                            <SelectItem key={y} value={y.toString()}>
                                                {y}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Month Selection */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                                    Month
                                </label>
                                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                                    <SelectTrigger className="w-full border-slate-300 h-10 shadow-sm">
                                        <SelectValue placeholder="Select Month" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {months.map((m) => (
                                            <SelectItem key={m} value={m}>
                                                {m}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Generate Action Area */}
                        <div
                            className="mt-8 bg-indigo-50/50 border-2 border-dashed border-indigo-200 rounded-xl p-12 text-center hover:bg-indigo-50 transition-all cursor-pointer group"
                            onClick={handleGenerateInvoice}
                        >
                            <div className="bg-white p-4 rounded-full shadow-md w-20 h-20 flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                                <FileCheck className="h-10 w-10 text-indigo-600" />
                            </div>

                            <h3 className="text-lg font-bold text-indigo-900 mb-2">Generate</h3>
                            <p className="text-sm text-indigo-600/80 mb-6 max-w-sm mx-auto font-medium">
                                Click the button below to generate the client invoice based on the selected criteria.
                            </p>

                            <Button
                                className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-6 rounded-lg text-lg font-bold shadow-lg shadow-indigo-200 flex items-center gap-3 mx-auto"
                                disabled={generating}
                            >
                                {generating ? (
                                    <span className="flex items-center gap-2">
                                        <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white inline-block"></span>
                                        Viewing...
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-2">
                                        <ReceiptText className="h-6 w-6" />
                                        Generate Invoice
                                    </span>
                                )}
                            </Button>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}
