
import { Search, Edit, Upload, FileText, Scale } from "lucide-react";
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
import { cn, formatDate } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import React, { useState, useEffect } from "react";

import api from "@/services/api";

// ✅ TYPE (based on backend)
type Actuals = {
    client_eb_id: any;
    actual_month: number;
    actual_year: number;
    customer_name: string;
    sc_number: string;
};
export default function ActualsList() {
    const navigate = useNavigate();
    const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
    const [selectedMonth, setSelectedMonth] = useState<string>((new Date().getMonth() + 1).toString());
    
    const [searchKeyword, setSearchKeyword] = useState("");

    const [appliedYear, setAppliedYear] = useState<string>(new Date().getFullYear().toString());
    const [appliedMonth, setAppliedMonth] = useState<string>((new Date().getMonth() + 1).toString());
    const [appliedWm, setAppliedWm] = useState("");
     const [data, setData] = useState<Actuals[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedCustomer, setSelectedCustomer] = useState("");
const [selectedSc, setSelectedSc] = useState("");
const [appliedCustomer, setAppliedCustomer] = useState("");
const [appliedSc, setAppliedSc] = useState("");
const currentYear = new Date().getFullYear();
const years: number[] = Array.from({ length: 5 }, (_, i) => currentYear - i);
const [customers, setCustomers] = useState<string[]>([]);
const [scNumbers, setScNumbers] = useState<string[]>([]);
const [isFilterApplied, setIsFilterApplied] = useState(false);





    useEffect(() => {
        fetchActuals();
    }, []);


    useEffect(() => {
    setSelectedSc(""); // reset SC when customer changes

    if (selectedCustomer) {
        const filtered = data.filter(
            (item) => item.customer_name === selectedCustomer
        );

        const uniqueSc = [...new Set(filtered.map((item) => item.sc_number))];
        setScNumbers(uniqueSc);
    } else {
        setScNumbers([]);
    }
}, [selectedCustomer, data]);



   const fetchActuals = async () => {
    try {
        setLoading(true);

        const res = await api.get<Actuals[]>("/actuals/list");
        const apiData = res.data;

        // ✅ Set main data
        setData(apiData);

        // ✅ Unique Customers
        const uniqueCustomers = Array.from(
            new Set(apiData.map((item) => item.customer_name))
        );
        setCustomers(uniqueCustomers);

        // ✅ Unique SC Numbers (ALL SC initially)
        const uniqueScNumbers = Array.from(
            new Set(apiData.map((item) => item.sc_number))
        );
        setScNumbers(uniqueScNumbers);

    } catch (error) {
        console.error("API Error:", error);
    } finally {
        setLoading(false);
    }
};


    const handleSearch = () => {
    setAppliedYear(selectedYear);
    setAppliedMonth(selectedMonth);
    setAppliedCustomer(selectedCustomer);
    setAppliedSc(selectedSc);
    setIsFilterApplied(true); // ✅ apply filter only after click
};

const handleCancel = () => {
    const currentYear = new Date().getFullYear().toString();
    const currentMonth = (new Date().getMonth() + 1).toString();

    setSelectedYear(currentYear);
    setSelectedMonth(currentMonth);
    setSelectedCustomer("");
    setSelectedSc("");
    setSearchKeyword("");

    setAppliedYear(currentYear);
    setAppliedMonth(currentMonth);
    setAppliedCustomer("");
    setAppliedSc("");

    setIsFilterApplied(false); // ✅ show all data again
};


     const filteredData = data.filter((row) => {
    // ✅ Apply dropdown filters only if search button clicked
    const matchesYear = !isFilterApplied || row.actual_year.toString() === appliedYear;
    const matchesMonth = !isFilterApplied || row.actual_month.toString() === appliedMonth;

    const matchesCustomer =
        !isFilterApplied ||
        appliedCustomer === "" ||
        appliedCustomer === "all" ||
        row.customer_name === appliedCustomer;

    const matchesSc =
        !isFilterApplied ||
        appliedSc === "" ||
        appliedSc === "all" ||
        row.sc_number === appliedSc;

    // ✅ Keyword search ALWAYS works
    const matchesSearch =
        searchKeyword === "" ||
        Object.values(row).some((val) =>
            String(val).toLowerCase().includes(searchKeyword.toLowerCase())
        );

    return (
        matchesYear &&
        matchesMonth &&
        matchesCustomer &&
        matchesSc &&
        matchesSearch
    );
});

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

    return (
        <div className="p-2 bg-slate-50 min-h-screen font-sans">
            <div className="max-w-7xl mx-auto bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                {/* Header */}
                <div className="p-3 space-y-2">
                    {/* Page Title */}
                    <div className="flex items-center justify-between pb-0">
                        <h1 className="text-xl font-bold text-slate-800">Actuals</h1>
                    </div>

                    {/* Search Filters */}
                    <div className="space-y-1">
                        <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap gap-2 items-center">
                            <span className="text-sm font-semibold text-slate-600 mr-2">Search</span>
                            {/* Customer Dropdown */}
<Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
                                <SelectTrigger className="w-[180px] h-9 bg-white border-slate-300 text-sm">
                                    <SelectValue placeholder="Select Customer" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Customers</SelectItem>
                                    {customers.map((cust) => (
                                        <SelectItem key={cust} value={cust}>
                                            {cust}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            {/* Year Selection */}
                            <Select value={selectedYear} onValueChange={setSelectedYear}>
                                <SelectTrigger className="w-[140px] h-9 bg-white border-slate-300 text-sm">
                                    <SelectValue placeholder="Select Year" />
                                </SelectTrigger>
                                <SelectContent>
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
                                    <SelectValue placeholder="Select Month" />
                                </SelectTrigger>
                                <SelectContent>
                                    {months.map((month) => (
                                        <SelectItem key={month.value} value={month.value}>
                                            {month.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <div className="flex-1"></div>

                            <Button size="sm" className="h-9 text-sm bg-primary hover:bg-primary/90 text-primary-foreground px-4" onClick={handleSearch}>
                                Search
                            </Button>
                            <Button size="sm" className="h-9 text-sm bg-emerald-600 hover:bg-emerald-700 text-white px-4" onClick={() => navigate("/windmill/actuals/add")}>
                                + New
                            </Button>
                            <Button size="sm" className="h-9 text-sm bg-[#DAA520] hover:bg-[#B8860B] text-white px-4">
                                Export Excel
                            </Button>
                            <Button size="sm" className="h-9 text-sm bg-red-600 hover:bg-red-700 text-white px-4" onClick={handleCancel}>
                                Cancel
                            </Button>
                        </div>
                    </div>

                    {/* Transaction List */}
                    <div className="space-y-2">
                        <div className="flex justify-between items-center bg-primary/5 p-2 rounded-t-lg border-b border-primary/10 h-10">
                            <h2 className="text-sm font-semibold text-primary pl-2">Actuals List</h2>

                            <div className="flex items-center gap-4">


                                <div className="relative w-64">
                                    <Search className="absolute right-2 top-2.5 h-4 w-4 text-slate-400" />
                                    <Input
                                        placeholder="Keyword search..."
                                        className="bg-white border-slate-300 pr-8 h-9 text-sm"
                                        value={searchKeyword}
                                        onChange={(e) => setSearchKeyword(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="border border-slate-200 rounded-b-lg overflow-hidden mt-0">
                            <Table>
                                <TableHeader className="bg-sidebar">
                                    <TableRow className="h-8">
                                        <TableHead className="font-semibold text-white py-1 h-8 whitespace-nowrap text-xs">Month</TableHead>
                                        <TableHead className="font-semibold text-white py-1 h-8 whitespace-nowrap text-xs">Year</TableHead>
                                        <TableHead className="font-semibold text-white py-1 h-8 whitespace-nowrap text-xs">Customer</TableHead>
                                        <TableHead className="font-semibold text-white py-1 h-8 whitespace-nowrap text-xs">SC Number</TableHead>
                                        <TableHead className="font-semibold text-white py-1 h-8 whitespace-nowrap text-xs text-center">PDF</TableHead>
                                        <TableHead className="font-semibold text-white py-1 h-8 whitespace-nowrap text-xs text-center">Auto Reconciled Bill</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredData.length > 0 ? (
                                        filteredData.map((row,index) => (
                                            <TableRow key={index} className="hover:bg-slate-50 h-8">
                                                <TableCell className="py-1 text-xs">{months.find(m => m.value === row.actual_month.toString())?.label}</TableCell>
                                                <TableCell className="py-1 text-xs">{row.actual_year}</TableCell>
                                                <TableCell className="py-1 text-xs">{row.customer_name}</TableCell>
                                                <TableCell className="py-1 text-xs">{row.sc_number}</TableCell>
                                                <TableCell className="py-1 text-center">
                                                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => navigate(`/windmill/actuals/pdf/${row.client_eb_id}`)}>
                                                        <FileText className="h-3.5 w-3.5 text-red-500" />
                                                    </Button>
                                                </TableCell>
                                                <TableCell className="py-1 text-center">
                                                    <Button variant="ghost" size="icon" className="h-6 w-6">
                                                        <FileText className="h-3.5 w-3.5 text-red-500" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center py-4 text-slate-500">
                                                No records found
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
};
