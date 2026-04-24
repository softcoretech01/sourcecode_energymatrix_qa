import React, { useState, useEffect } from "react";
import { Search as SearchIcon, Printer, Edit, X, Plus } from "lucide-react";
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
import api from "@/services/api";

interface InvoiceRecord {
    id: number;
    year: number;
    month: string;
    customer_name: string;
    service_number: string;
}

export default function ClientInvoiceList() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [selectedCustomer, setSelectedCustomer] = useState<string>("all");
    const [selectedYear, setSelectedYear] = useState<string>("all");
    const [selectedMonth, setSelectedMonth] = useState<string>("all");
    const [keyword, setKeyword] = useState<string>("");
    const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);

    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

    const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    const [customers, setCustomers] = useState<{ id: number; customer_name: string }[]>([]);

    useEffect(() => {
        fetchInvoices();
        fetchCustomers();
    }, []);

    const fetchCustomers = async () => {
        try {
            const res = await api.get("/customers");
            setCustomers(res.data);
        } catch (err) {
            console.error("Error fetching customers:", err);
        }
    };

    const fetchInvoices = async () => {
        setLoading(true);
        try {
            const params: any = {};
            if (selectedCustomer !== "all") params.customer_id = selectedCustomer;
            if (selectedYear !== "all") params.year = selectedYear;
            if (selectedMonth !== "all") params.month = selectedMonth;

            const res = await api.get("/invoices", { params });
            setInvoices(res.data.data);
        } catch (err) {
            console.error("Error fetching invoices:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = () => {
        fetchInvoices();
    };

    const handleCancel = () => {
        setSelectedCustomer("all");
        setSelectedYear("all");
        setSelectedMonth("all");
        setKeyword("");
        // Optionally re-fetch after reset
        setLoading(true);
        api.get("/invoices").then(res => {
            setInvoices(res.data.data);
            setLoading(false);
        });
    };

    return (
        <div className="p-2 bg-slate-50 min-h-screen font-sans">
            <div className="max-w-7xl mx-auto bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                {/* Header */}
                <div className="p-3 space-y-2">
                    {/* Page Title */}
                    <div className="flex items-center justify-between pb-1">
                        <h1 className="text-xl font-bold text-slate-800">Client Invoice - List</h1>
                    </div>

                    {/* Search Filters */}
                    <div className="space-y-1">
                        <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap gap-2 items-center">
                            <span className="text-sm font-semibold text-slate-600 mr-2">Search</span>

                            {/* Customer Selection */}
                            <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
                                <SelectTrigger className="w-[200px] h-9 bg-white border-slate-300 text-sm">
                                    <SelectValue placeholder="All Customers" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Customers</SelectItem>
                                    {customers.map((c) => (
                                        <SelectItem key={c.id} value={c.id.toString()}>
                                            {c.customer_name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            {/* Year Selection */}
                            <Select value={selectedYear} onValueChange={setSelectedYear}>
                                <SelectTrigger className="w-[140px] h-9 bg-white border-slate-300 text-sm">
                                    <SelectValue placeholder="All Years" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Years</SelectItem>
                                    {years.map((year) => (
                                        <SelectItem key={year} value={year.toString()}>
                                            {year}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            {/* Month Selection */}
                            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                                <SelectTrigger className="w-[140px] h-9 bg-white border-slate-300 text-sm">
                                    <SelectValue placeholder="All Months" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Months</SelectItem>
                                    {months.map((month) => (
                                        <SelectItem key={month} value={month}>
                                            {month}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <div className="flex-1"></div>

                            <div className="flex items-center gap-2">
                                <Button onClick={handleSearch} size="sm" className="h-9 text-sm bg-primary hover:bg-primary/90 text-primary-foreground px-4 flex items-center gap-2">
                                    <SearchIcon className="h-4 w-4" />
                                    Search
                                </Button>
                                <Button size="sm" className="h-9 text-sm bg-emerald-600 hover:bg-emerald-700 text-white px-4 flex items-center gap-2" onClick={() => navigate("/windmill/client-invoice/add")}>
                                    <Plus className="h-4 w-4" />
                                    New
                                </Button>
                                <Button size="sm" className="h-9 text-sm bg-red-600 hover:bg-red-700 text-white px-4 flex items-center gap-2" onClick={handleCancel}>
                                    <X className="h-4 w-4" />
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    </div>

                    {/* Transaction List */}
                    <div className="space-y-2">
                        <div className="flex justify-between items-center bg-primary/5 p-2 rounded-t-lg border-b border-primary/10 h-10">
                            <h2 className="text-sm font-semibold text-primary pl-2">Client Invoice List</h2>

                            <div className="flex items-center gap-4">
                                <div className="relative w-64">
                                    <SearchIcon className="absolute right-2 top-2.5 h-4 w-4 text-slate-400" />
                                    <Input
                                        placeholder="Keyword search..."
                                        className="bg-white border-slate-300 pr-8 h-9 text-sm"
                                        value={keyword}
                                        onChange={(e) => setKeyword(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="border border-slate-200 rounded-b-lg overflow-hidden mt-0">
                            <Table>
                                <TableHeader className="bg-sidebar">
                                    <TableRow>
                                        <TableHead className="font-semibold text-white h-10 whitespace-nowrap">Year</TableHead>
                                        <TableHead className="font-semibold text-white h-10 whitespace-nowrap">Month</TableHead>
                                        <TableHead className="font-semibold text-white h-10 whitespace-nowrap">Customer Name</TableHead>
                                        <TableHead className="font-semibold text-white h-10 whitespace-nowrap">Service Number</TableHead>
                                        <TableHead className="font-semibold text-white h-10 whitespace-nowrap text-center">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center py-10 text-slate-500">
                                                Loading Invoices...
                                            </TableCell>
                                        </TableRow>
                                    ) : invoices.length > 0 ? (
                                        invoices.map((row) => (
                                            <TableRow key={row.id} className="hover:bg-slate-50">
                                                <TableCell className="py-2 text-sm">{row.year}</TableCell>
                                                <TableCell className="py-2 text-sm">{row.month}</TableCell>
                                                <TableCell className="py-2 text-sm font-medium">{row.customer_name}</TableCell>
                                                <TableCell className="py-2 text-sm">
                                                    <span
                                                        className="text-blue-600 hover:text-blue-800 cursor-pointer font-medium underline-offset-4 hover:underline"
                                                        onClick={() => navigate(`/windmill/client-invoice/pdf/${row.id}`)}
                                                    >
                                                        {row.service_number}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="py-2 text-center">
                                                    <div className="flex items-center justify-center gap-2">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                                            title="Print Invoice"
                                                            onClick={() => navigate(`/windmill/client-invoice/pdf/${row.id}?print=true`)}
                                                        >
                                                            <Printer className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-7 w-7 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                                                            title="Edit Invoice"
                                                            onClick={() => navigate(`/windmill/client-invoice/edit/${row.id}`)}
                                                        >
                                                            <Edit className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center py-10 text-slate-500">
                                                No Invoices found.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
