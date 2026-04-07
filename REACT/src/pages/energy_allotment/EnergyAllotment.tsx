import React, { useState, useEffect } from "react";
import api from "@/services/api";
import { useSidebar } from "@/components/ui/sidebar";
import { Search, Edit, Eye } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBoundary } from "@/components/ErrorBoundary";
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
    TableFooter,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const allotmentData = [
    { wm: "039224391798", customer: "L&T", seNumber: "SC-1001", consumption: "600", c1: "250", c1_pp: "300", c1_bank: "110", c2: "100", c2_pp: "150", c2_bank: "50", c4: "75", c4_pp: "100", c4_bank: "40", c5: "50", c5_pp: "80", c5_bank: "30", c1_allot: "0", c2_allot: "0", c4_allot: "0", c5_allot: "0" },
    { wm: "039214391145", customer: "Texmo", seNumber: "SC-2001", consumption: "525", c1: "200", c1_pp: "300", c1_bank: "120", c2: "90", c2_pp: "120", c2_bank: "40", c4: "70", c4_pp: "100", c4_bank: "30", c5: "45", c5_pp: "80", c5_bank: "20", c1_allot: "0", c2_allot: "0", c4_allot: "0", c5_allot: "0" },
    { wm: "059514500104", customer: "L&T", seNumber: "SC-1002", consumption: "450", c1: "150", c1_pp: "200", c1_bank: "80", c2: "80", c2_pp: "120", c2_bank: "40", c4: "60", c4_pp: "90", c4_bank: "30", c5: "40", c5_pp: "70", c5_bank: "20", c1_allot: "0", c2_allot: "0", c4_allot: "0", c5_allot: "0" },
];

// Charge lookup: charges keyed by "customer|seNumber"
const chargesLookup: Record<string, { mrc: number; omc: number; trc: number; oc1: number; kp: number; ec: number; shc: number; other: number; dc: number }> = {
    "L&T|SC-1001": { mrc: 100, omc: 200, trc: 150, oc1: 50, kp: 300, ec: 400, shc: 250, other: 60, dc: 70 },
    "L&T|SC-1002": { mrc: 110, omc: 220, trc: 160, oc1: 55, kp: 320, ec: 420, shc: 270, other: 65, dc: 75 },
    "L&T|SC-1004": { mrc: 130, omc: 240, trc: 175, oc1: 58, kp: 340, ec: 440, shc: 290, other: 75, dc: 85 },
    "Texmo|SC-2001": { mrc: 120, omc: 210, trc: 155, oc1: 52, kp: 310, ec: 410, shc: 260, other: 62, dc: 72 },
    "Texmo|SC-2002": { mrc: 125, omc: 215, trc: 158, oc1: 53, kp: 315, ec: 415, shc: 265, other: 64, dc: 74 },
    "Texmo|SC-2003": { mrc: 128, omc: 218, trc: 162, oc1: 54, kp: 318, ec: 418, shc: 268, other: 66, dc: 76 },
    "Texmo|SC-2005": { mrc: 135, omc: 230, trc: 170, oc1: 57, kp: 330, ec: 430, shc: 280, other: 70, dc: 80 },
    "ABC Corp|SC-3001": { mrc: 140, omc: 260, trc: 185, oc1: 62, kp: 360, ec: 460, shc: 310, other: 82, dc: 92 },
    "ABC Corp|SC-3002": { mrc: 145, omc: 265, trc: 190, oc1: 64, kp: 365, ec: 465, shc: 315, other: 84, dc: 94 },
    "XYZ Ltd|SC-4001": { mrc: 150, omc: 250, trc: 180, oc1: 60, kp: 350, ec: 450, shc: 300, other: 80, dc: 90 },
    "XYZ Ltd|SC-4002": { mrc: 155, omc: 255, trc: 182, oc1: 61, kp: 355, ec: 455, shc: 305, other: 81, dc: 91 },
};

// Customer list and their SE numbers (Restricted to 2 customers)
const customerSEMap: Record<string, string[]> = {
    "L&T": ["SC-1001", "SC-1002", "SC-1004"],
    "Texmo": ["SC-2001", "SC-2002", "SC-2003", "SC-2005"],
};
const customerList = Object.keys(customerSEMap);

// Solar Data: 2 Customers, listed by SE Number
const initialSolarData = [
    { customer: "L&T", seNumber: "SC-1001" },
    { customer: "L&T", seNumber: "SC-1002" },
    { customer: "L&T", seNumber: "SC-1004" },
    { customer: "Texmo", seNumber: "SC-2001" },
    { customer: "Texmo", seNumber: "SC-2002" },
    { customer: "Texmo", seNumber: "SC-2003" },
    { customer: "Texmo", seNumber: "SC-2005" },
];



type ChargeRow = {
    windmill: string;
    customer: string;
    seNumber: string;
    mrc: number; omc: number; trc: number; oc1: number; kp: number; ec: number; shc: number; other: number; dc: number;
};

type SolarRow = {
    isChecked: boolean;
    customer: string;
    seNumber: string;
    mrc: number; omc: number; trc: number; oc1: number; kp: number; ec: number; shc: number; other: number; dc: number;
};



const createInitialSolarRows = (): SolarRow[] =>
    initialSolarData.map(data => ({
        isChecked: false,
        customer: data.customer,
        seNumber: data.seNumber,
        mrc: 0, omc: 0, trc: 0, oc1: 0, kp: 0, ec: 0, shc: 0, other: 0, dc: 0,
        // Pre-fill charges from lookup if available
        ...(chargesLookup[`${data.customer}|${data.seNumber}`] || {})
    }));


export default function EnergyAllotment() {
    const { open } = useSidebar();
    const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
    const [selectedMonth, setSelectedMonth] = useState<string>((new Date().getMonth() + 1).toString());
    const [searchKeyword, setSearchKeyword] = useState("");
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // State for Uploads
    const [uploads, setUploads] = useState<Record<string, { file: File | null, fileName: string }>>({});

    const handleFileUpload = async (wm: string, file: File | null) => {
        if (!file) {
            setUploads(prev => ({ ...prev, [wm]: { file: null, fileName: "" } }));
            return;
        }
        
        // Update local file state immediately for UI
        setUploads(prev => ({
            ...prev,
            [wm]: { file, fileName: file.name }
        }));

        // Automatically upload to the backend and fetch extracted data
        const windmillObj = windmillsDetailed.find(w => w.windmill_number === wm);
        if (!windmillObj) {
            toast.error(`Windmill ID not found for ${wm}`);
            return;
        }

        try {
            toast.info(`Uploading EB Statement for ${wm}...`);
            const formData = new FormData();
            formData.append("windmill_id", windmillObj.id.toString());
            formData.append("year", selectedYear);
            formData.append("month", selectedMonth);
            formData.append("file", file);

            const response = await api.post("/eb/upload", formData, {
                headers: { "Content-Type": "multipart/form-data" }
            });

            if (response.data && response.data.parsed_data) {
                const parsed = response.data.parsed_data;
                toast.success(`Successfully uploaded and extracted data for ${wm}!`);
                
                // Update the grid values instantly
                setEbSummaryData(prev => ({
                    ...prev,
                    [wm]: {
                        ...prev[wm],
                        c1_pp: parsed.slots?.C1 || "0",
                        c1_bank: parsed.banking_slots?.C1 || "0",
                        c2_pp: parsed.slots?.C2 || "0",
                        c2_bank: parsed.banking_slots?.C2 || "0",
                        c4_pp: parsed.slots?.C4 || "0",
                        c4_bank: parsed.banking_slots?.C4 || "0",
                        c5_pp: parsed.slots?.C5 || "0",
                        c5_bank: parsed.banking_slots?.C5 || "0",
                    }
                }));

                // Auto-save the details using the header_id returned by upload
                if (response.data.header_id) {
                    try {
                        const detailsPayload = {
                            eb_header_id: response.data.header_id,
                            slots: parsed.slots,
                            banking_slots: parsed.banking_slots,
                            banking_units: parsed.banking_units || "0",
                            charges: parsed.charges || []
                        };
                        await api.post("/eb/save-all", detailsPayload);
                        console.log(`Auto-saved EB statement details for ${wm}`);
                    } catch (e) {
                        console.error("Failed to auto-save EB details:", e);
                    }
                }
            }
        } catch (error: any) {
            console.error("Upload error:", error);
            const errMsg = error.response?.data?.detail || "Failed to upload file.";
            toast.error(errMsg);
        }
    };

    // State for Charge Allocation (8 windmills)

    // State for Dynamic Windmill Headers
    const [windmillNumbers, setWindmillNumbers] = useState<string[]>(["WM-001", "WM-002", "WM-003", "WM-004", "WM-005", "WM-006", "WM-007", "WM-008", "SOLAR-001"]);
    const [windmillsDetailed, setWindmillsDetailed] = useState<any[]>([]);

    useEffect(() => {
        const fetchWindmills = async () => {
            try {
                const response = await api.get("/windmills/active-posted");
                if (Array.isArray(response.data)) {
                    const numbers = response.data.map((item: any) => item.windmill_number).filter(Boolean);
                    if (numbers.length > 0) {
                        setWindmillNumbers(numbers);
                        setWindmillsDetailed(response.data);
                        toast.success(`Fetched ${numbers.length} active windmills.`);
                    } else {
                        toast.warning("No active windmills found.");
                    }
                } else {
                    toast.error("Unexpected response format from server.");
                }
            } catch (error) {
                console.error("Error fetching windmills:", error);
                toast.error("Failed to connect to server for windmill headers.");
            }
        };
        fetchWindmills();
    }, []);

    // State for Charge Allocation
    const [chargeAllocationRows, setChargeAllocationRows] = useState<ChargeRow[]>([]);

    useEffect(() => {
        setChargeAllocationRows(windmillNumbers.map(wm => ({
            windmill: wm, customer: "", seNumber: "",
            mrc: 0, omc: 0, trc: 0, oc1: 0, kp: 0, ec: 0, shc: 0, other: 0, dc: 0,
        })));
    }, [windmillNumbers]);

    // State for Solar Allocation
    const [solarAllocationRows, setSolarAllocationRows] = useState<SolarRow[]>(createInitialSolarRows());

    // State for Energy Allotment List
    const [energyAllotmentData, setEnergyAllotmentData] = useState<(typeof allotmentData[0] & Record<string, any>)[]>(allotmentData);
    const [consumptionRequests, setConsumptionRequests] = useState<any[]>([]);
    const [ebSummaryData, setEbSummaryData] = useState<Record<string, any>>({});

    useEffect(() => {
        const fetchConsumption = async () => {
            try {
                const response = await api.get(`/consumption-request/list?year=${selectedYear}&month=${selectedMonth}`);
                if (Array.isArray(response.data)) {
                    setConsumptionRequests(response.data);
                }
            } catch (error) {
                console.error("Error fetching consumption requests:", error);
            }
        };
        fetchConsumption();
    }, [selectedYear, selectedMonth]);

    useEffect(() => {
        const fetchCustomers = async () => {
            try {
                console.log("🔵 Fetching customers for energy allotment...");
                
                // Use the new endpoint that includes customer IDs
                const response = await api.get("/customers/for-energy-allotment");
                console.log("🔵 Raw API response:", response.data);
                console.log("🔵 Response type:", typeof response.data, " | Is Array:", Array.isArray(response.data));
                
                if (Array.isArray(response.data) && response.data.length > 0) {
                    console.log(`🔵 Received ${response.data.length} records`);
                    
                    const firstItem = response.data[0];
                    console.log("🔍 First record:", firstItem);
                    console.log("🔍 First record keys:", Object.keys(firstItem));
                    console.log("🔍 First record ID:", firstItem.id, "Type:", typeof firstItem.id);
                    
                    // Log all records to check ID population
                    response.data.forEach((item, idx) => {
                        console.log(`  [${idx}] ${item.customer_name} - ID: ${item.id} SE: ${item.service_number}`);
                    });
                    
                    // Create formatted data
                    const formattedData = response.data.map((item, idx) => {
                        // The API may return the PK as 'id', 'customer_id', 'cust_id', etc.
                        const customerId = item.id || item.customer_id || item.cust_id || item.mc_id || 0;
                        
                        if (!customerId || customerId === 0) {
                            console.warn(`⚠️  Row ${idx}: No customer ID for ${item.customer_name} — raw item keys:`, Object.keys(item), '| values:', item);
                        } else {
                            console.log(`✅ Row ${idx}: ${item.customer_name} → customer_id=${customerId}`);
                        }
                        
                        return {
                            customer_id: customerId,
                            service_id: item.service_id || 0,
                            wm: "",
                            customer: item.customer_name || item.customer,
                            seNumber: item.service_number || item.sc_number || '',
                            consumption: "0",
                            c1: "0", c1_pp: "0", c1_bank: "0",
                            c2: "0", c2_pp: "0", c2_bank: "0",
                            c4: "0", c4_pp: "0", c4_bank: "0",
                            c5: "0", c5_pp: "0", c5_bank: "0",
                            c1_allot: "0", c2_allot: "0", c4_allot: "0", c5_allot: "0"
                        };
                    });
                    
                    setEnergyAllotmentData(formattedData);
                    console.log("✅ Formatted data ready:", formattedData);
                    toast.success(`✓ Loaded ${formattedData.length} customer records`);
                } else {
                    console.warn("⚠️  Empty or invalid response");
                    toast.warning("No customers found. Fill in data manually.");
                }
            } catch (error: any) {
                console.error("❌ Error fetching customers:", error);
                if (error.response?.status === 401) {
                    toast.error("Session expired. Please login again.");
                } else {
                    toast.warning("Could not load customers. You can still enter data manually.");
                }
            }
        };
        fetchCustomers();
    }, []);

    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

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

    // Calculate Totals
    const totals = allotmentData.reduce((acc, row) => ({
        c1: acc.c1 + Number(row.c1.replace(/,/g, '')),
        c2: acc.c2 + Number(row.c2.replace(/,/g, '')),
        c4: acc.c4 + Number(row.c4.replace(/,/g, '')),
        c5: acc.c5 + Number(row.c5.replace(/,/g, '')),
        consumption: acc.consumption + Number(row.consumption.replace(/,/g, '')),
    }), { c1: 0, c2: 0, c4: 0, c5: 0, consumption: 0 });

    const handleEditClick = () => {
        // Date constraints removed for now as requested
        setIsEditing(!isEditing);
    };

    const fetchEbStatementSummary = async () => {
        try {
            console.log(`🔍 Fetching EB Statement totals for ${selectedYear}-${selectedMonth}...`);
            const response = await api.get(`/eb/summary/by-month?year=${selectedYear}&month=${selectedMonth}`);
            if (response.data && response.data.status === "success") {
                const summaryData = response.data.data;
                console.log("✅ EB Summary fetched successfully:", summaryData);
                setEbSummaryData(summaryData);
            } else {
                console.warn("⚠️ EB Summary response was not successful:", response.data);
            }
        } catch (error: any) {
            console.error("❌ Error fetching EB statement summary:", error?.response?.data || error.message);
        }
    };

    useEffect(() => {
        fetchEbStatementSummary();
    }, [selectedYear, selectedMonth]);

    const handleSearch = async () => {
        toast.info("Fetching Windmill EB Statement details for the selected period...");
        await fetchEbStatementSummary();
        toast.success("Fetched availability from EB Statements!");
    };

    const handleSave = async () => {
        if (isSaving) return;
        
        setIsSaving(true);
        try {
            if (!energyAllotmentData || energyAllotmentData.length === 0) {
                toast.error("No data available");
                setIsSaving(false);
                return;
            }

            let successCount = 0;
            let errorCount = 0;
            let skippedCount = 0;

            // Filter rows that have actual data
            const rowsWithData = energyAllotmentData.filter(row => {
                const hasData = 
                    (parseFloat(row.c1) || 0) !== 0 ||
                    (parseFloat(row.c1_bank) || 0) !== 0 ||
                    (parseFloat(row.c2) || 0) !== 0 ||
                    (parseFloat(row.c2_bank) || 0) !== 0 ||
                    (parseFloat(row.c4) || 0) !== 0 ||
                    (parseFloat(row.c4_bank) || 0) !== 0 ||
                    (parseFloat(row.c5) || 0) !== 0 ||
                    (parseFloat(row.c5_bank) || 0) !== 0 ||
                    (parseFloat(row.consumption) || 0) !== 0;
                return hasData;
            });

            if (rowsWithData.length === 0) {
                toast.warning("ℹ️ No rows with data. Fill in at least one field to save.");
                setIsSaving(false);
                return;
            }

            console.log(`📝 Processing ${rowsWithData.length} rows with data...`);

            for (const row of rowsWithData) {
                console.log(`\n🔄 Processing: ${row.customer} | Customer ID: ${row.customer_id} | Service: ${row.seNumber}`);
                
                // Skip if no customer and no service number
                if (!row.customer && !row.seNumber) {
                    console.warn(`⏭️  Skipped - No customer or service info`);
                    skippedCount++;
                    continue;
                }
                
                try {
                    // Guard: resolve customer_id from any field variant present on the row
                    const resolvedCustomerId = parseInt(String(
                        row.customer_id || row.id || row.cust_id || row.mc_id || 0
                    )) || 0;
                    
                    if (resolvedCustomerId === 0) {
                        console.error(`❌ SKIPPING ${row.customer} — customer_id resolved to 0. Row:`, row);
                        skippedCount++;
                        continue;
                    }

                    // Resolve windmill_id from windmill numbers mapping
                    const windmillObj = windmillsDetailed.find(w => w.windmill_number === row.wm);
                    const resolvedWindmillId = windmillObj?.id || 0;
                    
                    const payload = {
                        allotment_year: parseInt(selectedYear),
                        allotment_month: parseInt(selectedMonth),
                        allotment_date: new Date().toISOString().split('T')[0],
                        customer_id: resolvedCustomerId,
                        windmill_id: resolvedWindmillId,
                        service_id: row.service_id || 0,
                        service_number: row.seNumber ? String(row.seNumber).trim() : null,
                        c1_power: parseFloat(row.c1) || 0,
                        c1_banking: parseFloat(row.c1_bank) || 0,
                        c2_power: parseFloat(row.c2) || 0,
                        c2_banking: parseFloat(row.c2_bank) || 0,
                        c4_power: parseFloat(row.c4) || 0,
                        c4_banking: parseFloat(row.c4_bank) || 0,
                        c5_power: parseFloat(row.c5) || 0,
                        c5_banking: parseFloat(row.c5_bank) || 0,
                        requested_power: parseFloat(row.consumption) || 0,
                        requested_banking: 0,
                        allocated_power: parseFloat(row.c1_allot) || 0,
                        allocated_banking: 0,
                        utilized_power: 0,
                        utilized_banking: 0
                    };
                    
                    console.log("📤 Payload:", JSON.stringify(payload, null, 2));
                    
                    const response = await api.post("/windmills/energy-allotment/create", payload);
                    console.log("✅ Response:", response.status, response.data);
                    
                    if (response.status === 200 || response.data?.status === "success") {
                        toast.success(`✓ Saved: ${row.customer}${row.seNumber ? ' - ' + row.seNumber : ''}`);
                        console.log("✅ Successfully saved");
                        successCount++;
                    } else {
                        const errMsg = response.data?.error || response.data?.message || response.data?.detail || "Unexpected response";
                        toast.error(`✗ ${row.customer}: ${errMsg}`);
                        console.error("❌ Save failed:", errMsg);
                        errorCount++;
                    }
                } catch (rowError: any) {
                    console.error("❌ Exception for row:", row.customer, rowError);
                    
                    // Extract clean error message
                    let errorMsg = "Unknown error";
                    
                    if (rowError.response?.data) {
                        const errorData = rowError.response.data;
                        
                        if (Array.isArray(errorData)) {
                            // List of validation errors
                            errorMsg = errorData
                                .map((err: any) => {
                                    if (typeof err === 'object' && err.msg) {
                                        return String(err.msg);
                                    }
                                    return String(err);
                                })
                                .join("; ");
                        } else if (typeof errorData === 'object') {
                            // Object with detail or error field
                            errorMsg = (errorData.detail || errorData.error || JSON.stringify(errorData));
                            if (typeof errorMsg === 'object') {
                                errorMsg = JSON.stringify(errorMsg);
                            }
                        } else if (typeof errorData === 'string') {
                            errorMsg = errorData;
                        }
                    } else if (rowError.message) {
                        errorMsg = String(rowError.message);
                    }
                    
                    // Convert any remaining objects to string
                    errorMsg = String(errorMsg).replace(/\[object Object\]/g, "API Error");
                    
                    console.error("Extracted error:", errorMsg);
                    
                    if (!row.customer_id || row.customer_id === 0) {
                        toast.warning(`⚠️ ${row.customer}: No Customer ID - ${errorMsg.substring(0, 60)}`);
                    } else {
                        toast.error(`✗ ${row.customer}: ${errorMsg.substring(0, 80)}`);
                    }
                    
                    errorCount++;
                }
            }
            
            // Final summary
            const summary = `📊 Saved: ${successCount} | Skipped: ${skippedCount} | Errors: ${errorCount}`;
            console.log("\n" + summary);
            
            if (successCount > 0) {
                if (errorCount === 0 && skippedCount === 0) {
                    toast.success(`✅ All ${successCount} records saved!`);
                    setIsEditing(false);
                } else {
                    toast.info(summary);
                }
            } else {
                toast.error(`❌ No records saved. Errors: ${errorCount}`);
            }
        } catch (error: any) {
            console.error("❌ Top-level error:", error);
            toast.error("Unexpected error. Check console.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleChargeCustomerChange = (index: number, customer: string) => {
        const newData = [...chargeAllocationRows];
        newData[index] = { ...newData[index], customer, seNumber: "", mrc: 0, omc: 0, trc: 0, oc1: 0, kp: 0, ec: 0, shc: 0, other: 0, dc: 0 };
        setChargeAllocationRows(newData);
    };

    const handleChargeSEChange = (index: number, seNumber: string) => {
        const newData = [...chargeAllocationRows];
        const customer = newData[index].customer;
        const key = `${customer}|${seNumber}`;
        const charges = chargesLookup[key];
        if (charges) {
            newData[index] = { ...newData[index], seNumber, ...charges };
        } else {
            newData[index] = { ...newData[index], seNumber, mrc: 0, omc: 0, trc: 0, oc1: 0, kp: 0, ec: 0, shc: 0, other: 0, dc: 0 };
        }
        setChargeAllocationRows(newData);
    };

    const handleChargeFieldChange = (index: number, field: string, value: string) => {
        const newData = [...chargeAllocationRows];
        newData[index] = { ...newData[index], [field]: Number(value) || 0 };
        setChargeAllocationRows(newData);
    };

    // Handlers for Solar Allocation
    const handleSolarCheckChange = (index: number, checked: boolean) => {
        const newData = [...solarAllocationRows];
        newData[index].isChecked = checked;
        setSolarAllocationRows(newData);
    };

    const handleSolarFieldChange = (index: number, field: string, value: string) => {
        const newData = [...solarAllocationRows];
        // @ts-ignore
        newData[index][field] = Number(value) || 0;
        setSolarAllocationRows(newData);
    };

    const handleEnergyAllotmentChange = (index: number, field: string, value: string) => {
        const newData = [...energyAllotmentData];
        newData[index] = { ...newData[index], [field]: value };
        setEnergyAllotmentData(newData);
    };

    const handleGridUpdate = (customer: string, seNumber: string, wm: string, field: string, value: string) => {
        const index = energyAllotmentData.findIndex(d => d.customer === customer && d.seNumber === seNumber && d.wm === wm);

        // Subtraction Logic: Requested = Original - Allocated
        const originalReq = consumptionRequests.find(r => 
            r.customer_name === customer && 
            (r.sc_number === seNumber || r.sc_number === wm)
        );

        const getSubtractedValue = (allocVal: string, origVal: any) => {
            const a = parseFloat(allocVal) || 0;
            const o = parseFloat(origVal) || 0;
            const res = o - a;
            return res.toFixed(2).replace(/\.00$/, "");
        };

        if (index >= 0) {
            // Update existing
            const newData = [...energyAllotmentData];
            const updated: any = { ...newData[index], [field]: value };
            
            // Sync: Allocated -> Requested subtraction
            if (field === 'c1') updated.req_c1 = getSubtractedValue(value, originalReq?.c1);
            if (field === 'c2') updated.req_c2 = getSubtractedValue(value, originalReq?.c2);
            if (field === 'c4') updated.req_c4 = getSubtractedValue(value, originalReq?.c4);
            if (field === 'c5') updated.req_c5 = getSubtractedValue(value, originalReq?.c5);

            newData[index] = updated;
            setEnergyAllotmentData(newData);
        } else {
            // Create new entry — carry customer_id from the sibling (same customer+SE, different WM)
            const sibling = energyAllotmentData.find(d => d.customer === customer && d.seNumber === seNumber);
            // Resolve customer_id from sibling using all possible field name variants
            const resolvedCustId = sibling?.customer_id || sibling?.id || sibling?.cust_id || sibling?.mc_id || 0;
            const newEntry: any = {
                wm,
                customer,
                seNumber,
                customer_id: resolvedCustId,   // ← always carry the PK forward
                service_id: sibling?.service_id || 0,
                consumption: sibling ? sibling.consumption : "0",
                c1: "0", c1_pp: "0", c1_bank: "0",
                c2: "0", c2_pp: "0", c2_bank: "0",
                c4: "0", c4_pp: "0", c4_bank: "0",
                c5: "0", c5_pp: "0", c5_bank: "0",
                c1_allot: "0", c2_allot: "0", c4_allot: "0", c5_allot: "0",
                [field]: value
            };

            // Sync: Allocated -> Requested subtraction
            if (field === 'c1') newEntry.req_c1 = getSubtractedValue(value, originalReq?.c1);
            if (field === 'c2') newEntry.req_c2 = getSubtractedValue(value, originalReq?.c2);
            if (field === 'c4') newEntry.req_c4 = getSubtractedValue(value, originalReq?.c4);
            if (field === 'c5') newEntry.req_c5 = getSubtractedValue(value, originalReq?.c5);

            setEnergyAllotmentData([...energyAllotmentData, newEntry]);
        }
    };

    return (
        <ErrorBoundary>
            <div className="p-2 bg-slate-50 min-h-screen font-sans">
                <div className="max-w-full mx-auto bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-3 space-y-2">
                    {/* Page Title */}
                    <div className="flex items-center justify-between pb-1">
                        <h1 className="text-xl font-bold text-slate-800">Energy Allotment</h1>
                    </div>

                    {/* Search Filters */}
                    <div className="space-y-1">
                        <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg flex flex-nowrap gap-2 items-center">
                            <span className="text-sm font-semibold text-slate-600 mr-2">Search</span>
                            <Select>
                                <SelectTrigger className="w-[200px] h-9 bg-white border-slate-300 text-sm">
                                    <SelectValue placeholder="Select" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="wm-001">WM-001</SelectItem>
                                    <SelectItem value="wm-002">WM-002</SelectItem>
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

                            <Button size="sm" className="h-9 text-sm bg-[#0E7490] hover:bg-[#0C6159] text-white px-4" onClick={handleSearch}>
                                Search
                            </Button>
                            <Button size="sm" className="h-9 text-sm bg-red-600 hover:bg-red-700 text-white px-4 disabled:opacity-50 disabled:cursor-not-allowed" onClick={handleSave} disabled={isSaving}>
                                {isSaving ? "Saving..." : "Save"}
                            </Button>
                            <Button size="sm" className="h-9 text-sm bg-slate-500 hover:bg-slate-600 text-white px-4" onClick={() => setIsEditing(false)}>
                                Cancel
                            </Button>
                            <Button size="sm" className="h-9 text-sm bg-[#DAA520] hover:bg-[#B8860B] text-white px-4">
                                Export Excel
                            </Button>
                        </div>
                    </div>

                    {/* Table Section */}
                    <div className="space-y-2">
                        <Tabs defaultValue="list" className="w-full">
                            <div className="flex justify-between items-center bg-primary/5 p-2 rounded-t-lg border-b border-primary/10 h-12">
                                <TabsList className="bg-transparent p-0 h-auto">
                                    <TabsTrigger value="list" className="data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-md px-4 py-1.5 text-sm font-semibold text-slate-600">Energy Allotment List</TabsTrigger>
                                    <TabsTrigger value="allocation" className="data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-md px-4 py-1.5 text-sm font-semibold text-slate-600">Charge Allocation</TabsTrigger>
                                    <TabsTrigger value="uploads" className="data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-md px-4 py-1.5 text-sm font-semibold text-slate-600">Allotment Order Upload</TabsTrigger>
                                </TabsList>

                                <div className="flex items-center gap-2">
                                    <div className="relative w-64">
                                        <Search className="absolute right-2 top-2.5 h-4 w-4 text-slate-400" />
                                        <Input
                                            placeholder="Keyword search..."
                                            className="bg-white border-slate-300 pr-8 h-9 text-sm"
                                            value={searchKeyword}
                                            onChange={(e) => setSearchKeyword(e.target.value)}
                                        />
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-slate-500 hover:text-slate-700"
                                        onClick={handleEditClick}
                                    >
                                        <Edit className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>

                            <TabsContent value="list" className="mt-0">
                                <div className="flex justify-start gap-4 p-2 bg-white border-x border-slate-200">
                                    <div className="flex items-center gap-1.5 text-xs font-medium">
                                        <span className="font-bold text-amber-500">P</span>
                                        <span className="text-slate-600">- Power Plant Available</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-xs font-medium">
                                        <span className="font-bold text-red-500">B</span>
                                        <span className="text-slate-600">- Banking Units</span>
                                    </div>
                                </div>
                                <div className="border border-slate-200 rounded-b-lg mt-0 bg-white overflow-x-auto thin-scrollbar" style={{ maxWidth: open ? 'calc(100vw - 18rem)' : 'calc(100vw - 5rem)' }}>
                                    <Table noWrapper className="min-w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                                        <TableHeader className="bg-sidebar sticky top-0 z-40">
                                            <TableRow>
                                                <TableHead rowSpan={2} className="h-10 font-semibold text-white whitespace-nowrap min-w-[120px] w-[120px] border-r border-white/20 bg-sidebar sticky left-0 z-50">Customer</TableHead>
                                                <TableHead rowSpan={2} className="h-10 font-semibold text-white whitespace-nowrap min-w-[120px] w-[120px] border-r border-white/20 bg-sidebar sticky left-[120px] z-50">Service Number</TableHead>
                                                <TableHead rowSpan={2} className="h-10 font-semibold text-white whitespace-nowrap min-w-[120px] w-[120px] border-r border-white/20 bg-sidebar sticky left-[240px] z-50"></TableHead>
                                                {/* Dynamic Generator Columns */}
                                                {windmillNumbers.map((wm) => {
                                                    return (
                                                        <TableHead key={wm} colSpan={4} className="h-auto font-semibold text-center border-b border-r border-slate-400 last:border-r-0 p-0 align-top bg-white">
                                                            <div className="bg-sidebar text-white h-full flex items-center justify-center py-2">
                                                                {wm}
                                                            </div>
                                                        </TableHead>
                                                    );
                                                })}
                                                <TableHead rowSpan={2} className="h-10 font-semibold text-white text-center border-b border-r border-white/20 align-middle">Total</TableHead>
                                            </TableRow>
                                            <TableRow className="bg-sidebar/85 hover:bg-sidebar/85 border-b-0">
                                                {windmillNumbers.map((wm) => {
                                                    const wmItems = energyAllotmentData.filter(d => d.wm === wm);
                                                    const renderColHeader = (col: 'c1' | 'c2' | 'c4' | 'c5', label: string, isLast = false) => {
                                                        const totalPP = ebSummaryData[wm] ? Number(ebSummaryData[wm][`${col}_pp`]) || 0 : 0;
                                                        const totalBank = ebSummaryData[wm] ? Number(ebSummaryData[wm][`${col}_bank`]) || 0 : 0;
                                                        const totalAllocated = wmItems.reduce((acc, curr) => acc + (Number(String(curr[col]).replace(/,/g, '')) || 0), 0);
                                                        let displayPower = totalPP - totalAllocated;
                                                        let displayBank = totalBank;
                                                        if (displayPower < 0) {
                                                            displayBank = totalBank - Math.abs(displayPower);
                                                            displayPower = 0;
                                                        }
                                                        return (
                                                            <TableHead key={`${wm}-${col}`} className={`p-1 pt-1.5 pb-1 text-xs font-semibold text-white text-center border-r ${isLast ? 'border-white/20 last:border-r-0' : 'border-white/10'} align-bottom`}>
                                                                <div className="flex flex-col gap-1.5 mb-2 items-start w-fit mx-auto">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <span className="text-xs text-white font-bold w-4 text-right">P:</span>
                                                                        <input type="text" disabled value={displayPower} className="border border-black px-1 bg-white text-red-500 w-[46px] text-center font-bold h-[24px] text-xs focus:outline-none disabled:opacity-100 disabled:cursor-default" />
                                                                    </div>
                                                                    <div className="flex items-center gap-1.5">
                                                                        <span className="text-xs text-white font-bold w-4 text-right">B:</span>
                                                                        <input type="text" disabled value={displayBank} className="border border-black px-1 bg-white text-red-500 w-[46px] text-center font-bold h-[24px] text-xs focus:outline-none disabled:opacity-100 disabled:cursor-default" />
                                                                    </div>
                                                                </div>
                                                                <div className="pb-0.5">{label}</div>
                                                            </TableHead>
                                                        );
                                                    };

                                                    return (
                                                        <React.Fragment key={wm}>
                                                            {renderColHeader('c1', 'C1')}
                                                            {renderColHeader('c2', 'C2')}
                                                            {renderColHeader('c4', 'C4')}
                                                            {renderColHeader('c5', 'C5', true)}
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {/* Group Logic */}
                                            {(() => {
                                                const generators = windmillNumbers;
                                                // Group by Customer then SE Number
                                                // Group by Customer then SE Number
                                                const filteredData = energyAllotmentData.filter(item => {
                                                    if (searchKeyword === "") return true;
                                                    return Object.values(item).some(val =>
                                                        String(val).toLowerCase().includes(searchKeyword.toLowerCase())
                                                    );
                                                });

                                                const groupedData = filteredData.reduce((acc, item) => {
                                                    if (!acc[item.customer]) acc[item.customer] = new Set();
                                                    acc[item.customer].add(item.seNumber);
                                                    return acc;
                                                }, {} as Record<string, Set<string>>);

                                                const renderedOrder: { customer: string, seNumber: string }[] = [];
                                                Object.entries(groupedData).forEach(([c, seSet]) => Array.from(seSet).forEach(se => renderedOrder.push({ customer: c, seNumber: se })));

                                                return (
                                                    <React.Fragment>
                                                        {/* Power Plant Row */}
                                                        <TableRow className="bg-[#e0f2fe] border-b border-white hover:bg-[#e0f2fe]">
                                                            <TableCell colSpan={3} className="py-2 text-sm text-[#0369a1] font-bold border-r bg-[#e0f2fe] align-middle sticky left-0 z-20 text-center uppercase tracking-wide">
                                                                Power Plant
                                                            </TableCell>
                                                            {generators.map((wm) => {
                                                                const wmItems = energyAllotmentData.filter(d => d.wm === wm);
                                                                const renderC = (col: 'c1' | 'c2' | 'c4' | 'c5') => {
                                                                    const totalPP = ebSummaryData[wm] ? Number(ebSummaryData[wm][`${col}_pp`]) || 0 : 0;
                                                                    return <TableCell key={`${wm}-${col}-pp`} className="p-1 border-r text-center font-bold text-[#0369a1] text-[11px] bg-[#e0f2fe]">{totalPP}</TableCell>
                                                                };
                                                                return (
                                                                    <React.Fragment key={`${wm}-pp`}>
                                                                        {renderC('c1')}
                                                                        {renderC('c2')}
                                                                        {renderC('c4')}
                                                                        {renderC('c5')}
                                                                    </React.Fragment>
                                                                );
                                                            })}
                                                            <TableCell className="p-1 border-r bg-[#e0f2fe] font-bold text-[#0369a1] text-center">-</TableCell>
                                                        </TableRow>

                                                        {/* Banking Row */}
                                                        <TableRow className="bg-[#ffedd5] border-b-2 border-slate-300 hover:bg-[#ffedd5]">
                                                            <TableCell colSpan={3} className="py-2 text-sm text-[#c2410c] font-bold border-r bg-[#ffedd5] align-middle sticky left-0 z-20 text-center uppercase tracking-wide">
                                                                Banking
                                                            </TableCell>
                                                            {generators.map((wm) => {
                                                                const wmItems = energyAllotmentData.filter(d => d.wm === wm);
                                                                const renderC = (col: 'c1' | 'c2' | 'c4' | 'c5') => {
                                                                    const totalBank = ebSummaryData[wm] ? Number(ebSummaryData[wm][`${col}_bank`]) || 0 : 0;
                                                                    return <TableCell key={`${wm}-${col}-bank`} className="p-1 border-r text-center font-bold text-[#c2410c] text-[11px] bg-[#ffedd5]">{totalBank}</TableCell>
                                                                };
                                                                return (
                                                                    <React.Fragment key={`${wm}-bank`}>
                                                                        {renderC('c1')}
                                                                        {renderC('c2')}
                                                                        {renderC('c4')}
                                                                        {renderC('c5')}
                                                                    </React.Fragment>
                                                                );
                                                            })}
                                                            <TableCell className="p-1 border-r bg-[#ffedd5] font-bold text-[#c2410c] text-center">-</TableCell>
                                                        </TableRow>

                                                        {Object.entries(groupedData).map(([customer, seSet]) => {
                                                            const seList = Array.from(seSet);

                                                            // Calculate Totals for the Customer
                                                            // Requested: Sum of consumption for each unique SE Number
                                                            // Allocated: Sum of c1, c2, c4, c5 for ALL entries of this customer
                                                            const customerEntries = filteredData.filter(d => d.customer === customer);

                                                            // Consumption is per SE. Get one entry per SE to sum consumption.
                                                            const uniqueSEEntries = seList.map(se => customerEntries.find(d => d.seNumber === se)).filter(Boolean);
                                                            const totalRequested = uniqueSEEntries.reduce((acc, curr) => acc + (Number(curr?.consumption?.replace(/,/g, '') || 0)), 0);

                                                            const totalAllocated = customerEntries.reduce((acc, curr) => {
                                                                const c1 = Number(curr.c1?.replace(/,/g, '') || 0);
                                                                const c2 = Number(curr.c2?.replace(/,/g, '') || 0);
                                                                const c4 = Number(curr.c4?.replace(/,/g, '') || 0);
                                                                const c5 = Number(curr.c5?.replace(/,/g, '') || 0);
                                                                return acc + c1 + c2 + c4 + c5;
                                                            }, 0);

                                                            const rows = seList.map((seNumber, seIndex) => {
                                                                const rowItems = filteredData.filter(d => d.customer === customer && d.seNumber === seNumber);
                                                                const rowTotal = rowItems.reduce((acc, d) => acc + (Number(d.c1) || 0) + (Number(d.c2) || 0) + (Number(d.c4) || 0) + (Number(d.c5) || 0), 0);
                                                                const totalConsumptionReq = consumptionRequests.find(r => r.customer_name === customer && r.sc_number === seNumber);

                                                                // Calculate cumulative allocated amounts for this SE across all windmills
                                                                const totalAllocC1 = rowItems.reduce((acc, d) => acc + (parseFloat(d.c1) || 0), 0);
                                                                const totalAllocC2 = rowItems.reduce((acc, d) => acc + (parseFloat(d.c2) || 0), 0);
                                                                const totalAllocC4 = rowItems.reduce((acc, d) => acc + (parseFloat(d.c4) || 0), 0);
                                                                const totalAllocC5 = rowItems.reduce((acc, d) => acc + (parseFloat(d.c5) || 0), 0);

                                                                const getBalance = (orig: any, totalAlloc: number) => {
                                                                    const o = parseFloat(orig) || 0;
                                                                    const res = o - totalAlloc;
                                                                    return res.toFixed(2).replace(/\.00$/, "");
                                                                };

                                                                const balC1 = getBalance(totalConsumptionReq?.c1, totalAllocC1);
                                                                const balC2 = getBalance(totalConsumptionReq?.c2, totalAllocC2);
                                                                const balC4 = getBalance(totalConsumptionReq?.c4, totalAllocC4);
                                                                const balC5 = getBalance(totalConsumptionReq?.c5, totalAllocC5);

                                                                return (
                                                                    <React.Fragment key={`${customer}-${seNumber}`}>
                                                                        {/* Row 1: Requested */}
                                                                        <TableRow className="hover:bg-slate-50 border-t border-slate-200 group">
                                                                            {seIndex === 0 && (
                                                                                <TableCell rowSpan={seList.length * 4} className="py-2 text-sm text-indigo-700 font-bold border-r bg-white align-top border-b border-slate-200 sticky left-0 z-20 w-[120px] min-w-[120px]">
                                                                                    {customer}
                                                                                </TableCell>
                                                                            )}
                                                                            <TableCell rowSpan={4} className="py-2 text-sm text-slate-800 font-bold border-r bg-white align-top border-b border-slate-200 sticky left-[120px] z-20 w-[120px] min-w-[120px]">
                                                                                <div className="flex flex-col gap-2">
                                                                                    <span>{seNumber}</span>
                                                                                    <div className="flex flex-col text-[10px] font-semibold gap-1">
                                                                                        <span><span className="text-slate-500">Requested:</span> <span className="text-[#B22222]">{parseFloat(getBalance(totalConsumptionReq?.total, rowTotal)) || '0'}</span></span>
                                                                                        <span><span className="text-slate-500">Allocated:</span> <span className="text-[#B22222]">{rowTotal}</span></span>
                                                                                    </div>
                                                                                </div>
                                                                            </TableCell>
                                                                            <TableCell className="py-2 px-2 text-xs text-slate-600 font-semibold border-r bg-white sticky left-[240px] z-20 w-[120px] min-w-[120px]">
                                                                                Requested
                                                                            </TableCell>
                                                                            {generators.map(wm => {
                                                                                return (
                                                                                    <React.Fragment key={wm}>
                                                                                        <TableCell className="p-1 border-r text-center">
                                                                                            <Input
                                                                                                disabled
                                                                                                className="h-7 text-center text-xs px-0"
                                                                                                value={balC1}
                                                                                            />
                                                                                        </TableCell>
                                                                                        <TableCell className="p-1 border-r text-center">
                                                                                            <Input
                                                                                                disabled
                                                                                                className="h-7 text-center text-xs px-0"
                                                                                                value={balC2}
                                                                                            />
                                                                                        </TableCell>
                                                                                        <TableCell className="p-1 border-r text-center">
                                                                                            <Input
                                                                                                disabled
                                                                                                className="h-7 text-center text-xs px-0"
                                                                                                value={balC4}
                                                                                            />
                                                                                        </TableCell>
                                                                                        <TableCell className="p-1 border-r text-center">
                                                                                            <Input
                                                                                                disabled
                                                                                                className="h-7 text-center text-xs px-0"
                                                                                                value={balC5}
                                                                                            />
                                                                                        </TableCell>
                                                                                    </React.Fragment>
                                                                                );
                                                                            })}
                                                                            <TableCell className="p-1 border-r text-center align-middle bg-slate-50 font-bold text-slate-700 text-xs py-2">-</TableCell>
                                                                        </TableRow>

                                                                        {/* Row 2: Allocated */}
                                                                        <TableRow className="hover:bg-slate-50 group">
                                                                            <TableCell className="py-2 px-2 text-xs text-slate-600 font-semibold border-r bg-white sticky left-[240px] z-20 w-[120px] min-w-[120px]">
                                                                                Allocated
                                                                            </TableCell>
                                                                            {generators.map(wm => {
                                                                                const item = filteredData.find(d => d.customer === customer && d.seNumber === seNumber && d.wm === wm);
                                                                                return (
                                                                                    <React.Fragment key={wm}>
                                                                                        <TableCell className="p-1 border-r text-center"><Input className="h-7 text-center text-xs px-0" value={item ? item.c1 : ''} onChange={(e) => handleGridUpdate(customer, seNumber, wm, 'c1', e.target.value)} /></TableCell>
                                                                                        <TableCell className="p-1 border-r text-center"><Input className="h-7 text-center text-xs px-0" value={item ? item.c2 : ''} onChange={(e) => handleGridUpdate(customer, seNumber, wm, 'c2', e.target.value)} /></TableCell>
                                                                                        <TableCell className="p-1 border-r text-center"><Input className="h-7 text-center text-xs px-0" value={item ? item.c4 : ''} onChange={(e) => handleGridUpdate(customer, seNumber, wm, 'c4', e.target.value)} /></TableCell>
                                                                                        <TableCell className="p-1 border-r text-center"><Input className="h-7 text-center text-xs px-0" value={item ? item.c5 : ''} onChange={(e) => handleGridUpdate(customer, seNumber, wm, 'c5', e.target.value)} /></TableCell>
                                                                                    </React.Fragment>
                                                                                );
                                                                            })}
                                                                            <TableCell className="p-1 border-r text-center align-middle bg-slate-50 font-bold text-slate-700 text-xs py-2">{rowTotal}</TableCell>
                                                                        </TableRow>

                                                                        {/* Row 3: Utilized Power */}
                                                                        <TableRow className="hover:bg-slate-50 group">
                                                                            <TableCell className="py-2 px-2 text-xs text-slate-600 font-semibold border-r bg-white sticky left-[240px] z-20 w-[120px] min-w-[120px]">
                                                                                Utilized Power
                                                                            </TableCell>
                                                                            {generators.map(wm => {
                                                                                const item = filteredData.find(d => d.customer === customer && d.seNumber === seNumber && d.wm === wm);
                                                                                const getUP = (col: string) => {
                                                                                    if (!item) return '-';
                                                                                    const totalPP = ebSummaryData[wm] ? Number(ebSummaryData[wm][`${col}_pp`]) || 0 : 0;
                                                                                    const currentIndex = renderedOrder.findIndex(r => r.customer === customer && r.seNumber === seNumber);
                                                                                    let prevAlloc = 0;
                                                                                    for (let i = 0; i < currentIndex; i++) {
                                                                                        const r = renderedOrder[i];
                                                                                        const prevItem = filteredData.find(d => d.customer === r.customer && d.seNumber === r.seNumber && d.wm === wm);
                                                                                        if (prevItem) {
                                                                                            prevAlloc += Number(String(prevItem[col] || '0').replace(/,/g, ''));
                                                                                        }
                                                                                    }
                                                                                    let availablePP = totalPP - prevAlloc;
                                                                                    if (availablePP < 0) availablePP = 0;
                                                                                    const alloc = Number(String(item[col] || '0').replace(/,/g, ''));
                                                                                    return Math.min(alloc, availablePP) || 0;
                                                                                };
                                                                                return (
                                                                                    <React.Fragment key={wm}>
                                                                                        <TableCell className="p-1 border-r text-center text-[#B22222] font-semibold text-xs">{getUP('c1')}</TableCell>
                                                                                        <TableCell className="p-1 border-r text-center text-[#B22222] font-semibold text-xs">{getUP('c2')}</TableCell>
                                                                                        <TableCell className="p-1 border-r text-center text-[#B22222] font-semibold text-xs">{getUP('c4')}</TableCell>
                                                                                        <TableCell className="p-1 border-r text-center text-[#B22222] font-semibold text-xs">{getUP('c5')}</TableCell>
                                                                                    </React.Fragment>
                                                                                );
                                                                            })}
                                                                            <TableCell className="p-1 border-r text-center align-middle bg-slate-50 font-bold text-slate-700 text-xs py-2">-</TableCell>
                                                                        </TableRow>

                                                                        {/* Row 4: Utilized Bank */}
                                                                        <TableRow className="hover:bg-slate-50 border-b border-slate-200 group">
                                                                            <TableCell className="py-2 px-2 text-xs text-slate-600 font-semibold border-r bg-white sticky left-[240px] z-20 w-[120px] min-w-[120px]">
                                                                                Utilized Bank
                                                                            </TableCell>
                                                                            {generators.map(wm => {
                                                                                const item = filteredData.find(d => d.customer === customer && d.seNumber === seNumber && d.wm === wm);
                                                                                const getUB = (col: string) => {
                                                                                    if (!item) return '-';
                                                                                    const totalPP = ebSummaryData[wm] ? Number(ebSummaryData[wm][`${col}_pp`]) || 0 : 0;
                                                                                    const totalBank = ebSummaryData[wm] ? Number(ebSummaryData[wm][`${col}_bank`]) || 0 : 0;
                                                                                    const currentIndex = renderedOrder.findIndex(r => r.customer === customer && r.seNumber === seNumber);
                                                                                    let prevAlloc = 0;
                                                                                    for (let i = 0; i < currentIndex; i++) {
                                                                                        const r = renderedOrder[i];
                                                                                        const prevItem = filteredData.find(d => d.customer === r.customer && d.seNumber === r.seNumber && d.wm === wm);
                                                                                        if (prevItem) {
                                                                                            prevAlloc += Number(String(prevItem[col] || '0').replace(/,/g, ''));
                                                                                        }
                                                                                    }
                                                                                    let availablePP = totalPP - prevAlloc;
                                                                                    if (availablePP < 0) availablePP = 0;
                                                                                    const alloc = Number(String(item[col] || '0').replace(/,/g, ''));
                                                                                    const utilizedPower = Math.min(alloc, availablePP) || 0;
                                                                                    let bankUsedBefore = prevAlloc - totalPP;
                                                                                    if (bankUsedBefore < 0) bankUsedBefore = 0;
                                                                                    let availableBank = totalBank - bankUsedBefore;
                                                                                    if (availableBank < 0) availableBank = 0;
                                                                                    const remainingAlloc = alloc - utilizedPower;
                                                                                    return Math.min(remainingAlloc, availableBank) || 0;
                                                                                };
                                                                                return (
                                                                                    <React.Fragment key={wm}>
                                                                                        <TableCell className="p-1 border-r text-center text-[#B22222] font-semibold text-xs">{getUB('c1')}</TableCell>
                                                                                        <TableCell className="p-1 border-r text-center text-[#B22222] font-semibold text-xs">{getUB('c2')}</TableCell>
                                                                                        <TableCell className="p-1 border-r text-center text-[#B22222] font-semibold text-xs">{getUB('c4')}</TableCell>
                                                                                        <TableCell className="p-1 border-r text-center text-[#B22222] font-semibold text-xs">{getUB('c5')}</TableCell>
                                                                                    </React.Fragment>
                                                                                );
                                                                            })}
                                                                            <TableCell className="p-1 border-r text-center align-middle bg-slate-50 font-bold text-slate-700 text-xs py-2">-</TableCell>
                                                                        </TableRow>
                                                                    </React.Fragment>
                                                                );
                                                            });
                                                            return (
                                                                <React.Fragment key={customer}>
                                                                    {rows}
                                                                    <TableRow className="bg-slate-50/80 border-b-2 border-slate-200">
                                                                        <TableCell className="py-2 text-sm font-bold text-slate-700 text-center border-r sticky left-0 z-20 bg-slate-100 w-[120px] min-w-[120px]">&nbsp;</TableCell>
                                                                        <TableCell className="py-2 text-sm font-bold text-slate-700 text-center border-r sticky left-[120px] z-20 bg-slate-100 w-[120px] min-w-[120px]">Total</TableCell>
                                                                        <TableCell className="py-2 text-sm font-bold text-slate-700 text-center border-r sticky left-[240px] z-20 bg-slate-100 w-[120px] min-w-[120px]">&nbsp;</TableCell>
                                                                        {generators.map(wm => {
                                                                            const total = filteredData
                                                                                .filter(d => d.customer === customer && d.wm === wm)
                                                                                .reduce((acc, curr) => {
                                                                                    const c1 = Number(String(curr.c1).replace(/,/g, '')) || 0;
                                                                                    const c2 = Number(String(curr.c2).replace(/,/g, '')) || 0;
                                                                                    const c4 = Number(String(curr.c4).replace(/,/g, '')) || 0;
                                                                                    const c5 = Number(String(curr.c5).replace(/,/g, '')) || 0;
                                                                                    return acc + c1 + c2 + c4 + c5;
                                                                                }, 0);
                                                                            return <TableCell key={wm} colSpan={4} className="py-2 text-center font-bold text-indigo-700 text-xs border-r">{total}</TableCell>;
                                                                        })}
                                                                        <TableCell className="py-2 text-center font-bold text-indigo-700 text-xs border-r">
                                                                            {filteredData.filter(d => d.customer === customer).reduce((acc, curr) => {
                                                                                const c1 = Number(String(curr.c1).replace(/,/g, '')) || 0;
                                                                                const c2 = Number(String(curr.c2).replace(/,/g, '')) || 0;
                                                                                const c4 = Number(String(curr.c4).replace(/,/g, '')) || 0;
                                                                                const c5 = Number(String(curr.c5).replace(/,/g, '')) || 0;
                                                                                return acc + c1 + c2 + c4 + c5;
                                                                            }, 0)}
                                                                        </TableCell>
                                                                    </TableRow>
                                                                </React.Fragment>
                                                            );
                                                        })}
                                                    </React.Fragment>
                                                );
                                            })()}
                                        </TableBody>

                                    </Table>
                                </div>
                            </TabsContent>

                            <TabsContent value="allocation" className="mt-0">
                                <div className="space-y-6">
                                    {/* Windmill Allocation Table */}
                                    <div className="border border-slate-200 rounded-b-lg overflow-hidden mt-0 bg-white overflow-x-auto thin-scrollbar">
                                        <Table>
                                            <TableHeader className="bg-sidebar">
                                                <TableRow>
                                                    <TableHead className="py-2 h-10 font-semibold text-white whitespace-nowrap pl-3">Windmill No</TableHead>
                                                    <TableHead className="py-2 h-10 font-semibold text-white whitespace-nowrap">Customer</TableHead>
                                                    <TableHead className="py-2 h-10 font-semibold text-white whitespace-nowrap">Service Number</TableHead>
                                                    <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap">M.R.C</TableHead>
                                                    <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap">O.M.C</TableHead>
                                                    <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap">T.R.C</TableHead>
                                                    <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap">O.C</TableHead>
                                                    <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap">K.P</TableHead>
                                                    <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap">E.C</TableHead>
                                                    <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap">S.H.C</TableHead>
                                                    <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap">O.C</TableHead>
                                                    <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap">D.C</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {chargeAllocationRows.map((row, index) => (
                                                    <TableRow key={row.windmill} className="hover:bg-slate-50 border-b border-slate-100">
                                                        <TableCell className="py-2 text-sm text-slate-900 font-bold border-r pl-3 whitespace-nowrap">{row.windmill}</TableCell>
                                                        <TableCell className="py-2 p-1 border-r min-w-[160px]">
                                                            <Select value={row.customer} onValueChange={(val) => handleChargeCustomerChange(index, val)} disabled={!isEditing}>
                                                                <SelectTrigger className="h-8 text-sm bg-white border-slate-200">
                                                                    <SelectValue placeholder="Select Customer" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {customerList.map(c => (
                                                                        <SelectItem key={c} value={c}>{c}</SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </TableCell>
                                                        <TableCell className="py-2 p-1 border-r min-w-[150px]">
                                                            <Select value={row.seNumber} onValueChange={(val) => handleChargeSEChange(index, val)} disabled={!isEditing || !row.customer}>
                                                                <SelectTrigger className="h-8 text-sm bg-white border-slate-200">
                                                                    <SelectValue placeholder="Select Service No" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {(customerSEMap[row.customer] || []).map(se => (
                                                                        <SelectItem key={se} value={se}>{se}</SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </TableCell>
                                                        <TableCell className="py-2 p-1 border-r"><Input disabled={!isEditing} className="h-8 text-right text-sm border-slate-200 shadow-none focus-visible:ring-1 bg-white disabled:bg-slate-50 disabled:text-slate-500" value={row.mrc} onChange={(e) => handleChargeFieldChange(index, 'mrc', e.target.value)} /></TableCell>
                                                        <TableCell className="py-2 p-1 border-r"><Input disabled={!isEditing} className="h-8 text-right text-sm border-slate-200 shadow-none focus-visible:ring-1 bg-white disabled:bg-slate-50 disabled:text-slate-500" value={row.omc} onChange={(e) => handleChargeFieldChange(index, 'omc', e.target.value)} /></TableCell>
                                                        <TableCell className="py-2 p-1 border-r"><Input disabled={!isEditing} className="h-8 text-right text-sm border-slate-200 shadow-none focus-visible:ring-1 bg-white disabled:bg-slate-50 disabled:text-slate-500" value={row.trc} onChange={(e) => handleChargeFieldChange(index, 'trc', e.target.value)} /></TableCell>
                                                        <TableCell className="py-2 p-1 border-r"><Input disabled={!isEditing} className="h-8 text-right text-sm border-slate-200 shadow-none focus-visible:ring-1 bg-white disabled:bg-slate-50 disabled:text-slate-500" value={row.oc1} onChange={(e) => handleChargeFieldChange(index, 'oc1', e.target.value)} /></TableCell>
                                                        <TableCell className="py-2 p-1 border-r"><Input disabled={!isEditing} className="h-8 text-right text-sm border-slate-200 shadow-none focus-visible:ring-1 bg-white disabled:bg-slate-50 disabled:text-slate-500" value={row.kp} onChange={(e) => handleChargeFieldChange(index, 'kp', e.target.value)} /></TableCell>
                                                        <TableCell className="py-2 p-1 border-r"><Input disabled={!isEditing} className="h-8 text-right text-sm border-slate-200 shadow-none focus-visible:ring-1 bg-white disabled:bg-slate-50 disabled:text-slate-500" value={row.ec} onChange={(e) => handleChargeFieldChange(index, 'ec', e.target.value)} /></TableCell>
                                                        <TableCell className="py-2 p-1 border-r"><Input disabled={!isEditing} className="h-8 text-right text-sm border-slate-200 shadow-none focus-visible:ring-1 bg-white disabled:bg-slate-50 disabled:text-slate-500" value={row.shc} onChange={(e) => handleChargeFieldChange(index, 'shc', e.target.value)} /></TableCell>
                                                        <TableCell className="py-2 p-1 border-r"><Input disabled={!isEditing} className="h-8 text-right text-sm border-slate-200 shadow-none focus-visible:ring-1 bg-white disabled:bg-slate-50 disabled:text-slate-500" value={row.other} onChange={(e) => handleChargeFieldChange(index, 'other', e.target.value)} /></TableCell>
                                                        <TableCell className="py-2 p-1 border-r"><Input disabled={!isEditing} className="h-8 text-right text-sm border-slate-200 shadow-none focus-visible:ring-1 bg-white disabled:bg-slate-50 disabled:text-slate-500" value={row.dc} onChange={(e) => handleChargeFieldChange(index, 'dc', e.target.value)} /></TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>

                                    {/* Solar Allocation Table */}
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 px-1">
                                            <h3 className="font-bold text-slate-700">SOLAR</h3>
                                        </div>
                                        <div className="border border-slate-200 rounded-lg overflow-hidden bg-white overflow-x-auto thin-scrollbar">
                                            <Table>
                                                <TableHeader className="bg-sidebar">
                                                    <TableRow>
                                                        <TableHead className="py-2 h-10 w-10 pl-3"></TableHead>
                                                        <TableHead className="py-2 h-10 font-semibold text-white whitespace-nowrap">Customer</TableHead>
                                                        <TableHead className="py-2 h-10 font-semibold text-white whitespace-nowrap">Service Number</TableHead>
                                                        <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap">M.R.C</TableHead>
                                                        <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap">O.M.C</TableHead>
                                                        <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap">T.R.C</TableHead>
                                                        <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap">O.C</TableHead>
                                                        <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap">K.P</TableHead>
                                                        <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap">E.C</TableHead>
                                                        <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap">S.H.C</TableHead>
                                                        <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap">O.C</TableHead>
                                                        <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap">D.C</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {solarAllocationRows.map((row, index) => (
                                                        <TableRow key={`${row.customer}-${row.seNumber}`} className="hover:bg-slate-50 border-b border-slate-100">
                                                            <TableCell className="py-2 pl-3">
                                                                <input
                                                                    type="checkbox"
                                                                    className="accent-indigo-700 h-4 w-4 rounded border-slate-300"
                                                                    checked={row.isChecked}
                                                                    onChange={(e) => handleSolarCheckChange(index, e.target.checked)}
                                                                    disabled={!isEditing}
                                                                />
                                                            </TableCell>
                                                            <TableCell className="py-2 text-sm text-slate-700 font-medium border-r">{row.customer}</TableCell>
                                                            <TableCell className="py-2 text-sm text-slate-600 border-r">{row.seNumber}</TableCell>
                                                            <TableCell className="py-2 p-1 border-r"><Input disabled={!isEditing} className="h-8 text-right text-sm border-slate-200 shadow-none focus-visible:ring-1 bg-white disabled:bg-slate-50 disabled:text-slate-500" value={row.mrc} onChange={(e) => handleSolarFieldChange(index, 'mrc', e.target.value)} /></TableCell>
                                                            <TableCell className="py-2 p-1 border-r"><Input disabled={!isEditing} className="h-8 text-right text-sm border-slate-200 shadow-none focus-visible:ring-1 bg-white disabled:bg-slate-50 disabled:text-slate-500" value={row.omc} onChange={(e) => handleSolarFieldChange(index, 'omc', e.target.value)} /></TableCell>
                                                            <TableCell className="py-2 p-1 border-r"><Input disabled={!isEditing} className="h-8 text-right text-sm border-slate-200 shadow-none focus-visible:ring-1 bg-white disabled:bg-slate-50 disabled:text-slate-500" value={row.trc} onChange={(e) => handleSolarFieldChange(index, 'trc', e.target.value)} /></TableCell>
                                                            <TableCell className="py-2 p-1 border-r"><Input disabled={!isEditing} className="h-8 text-right text-sm border-slate-200 shadow-none focus-visible:ring-1 bg-white disabled:bg-slate-50 disabled:text-slate-500" value={row.oc1} onChange={(e) => handleSolarFieldChange(index, 'oc1', e.target.value)} /></TableCell>
                                                            <TableCell className="py-2 p-1 border-r"><Input disabled={!isEditing} className="h-8 text-right text-sm border-slate-200 shadow-none focus-visible:ring-1 bg-white disabled:bg-slate-50 disabled:text-slate-500" value={row.kp} onChange={(e) => handleSolarFieldChange(index, 'kp', e.target.value)} /></TableCell>
                                                            <TableCell className="py-2 p-1 border-r"><Input disabled={!isEditing} className="h-8 text-right text-sm border-slate-200 shadow-none focus-visible:ring-1 bg-white disabled:bg-slate-50 disabled:text-slate-500" value={row.ec} onChange={(e) => handleSolarFieldChange(index, 'ec', e.target.value)} /></TableCell>
                                                            <TableCell className="py-2 p-1 border-r"><Input disabled={!isEditing} className="h-8 text-right text-sm border-slate-200 shadow-none focus-visible:ring-1 bg-white disabled:bg-slate-50 disabled:text-slate-500" value={row.shc} onChange={(e) => handleSolarFieldChange(index, 'shc', e.target.value)} /></TableCell>
                                                            <TableCell className="py-2 p-1 border-r"><Input disabled={!isEditing} className="h-8 text-right text-sm border-slate-200 shadow-none focus-visible:ring-1 bg-white disabled:bg-slate-50 disabled:text-slate-500" value={row.other} onChange={(e) => handleSolarFieldChange(index, 'other', e.target.value)} /></TableCell>
                                                            <TableCell className="py-2 p-1 border-r"><Input disabled={!isEditing} className="h-8 text-right text-sm border-slate-200 shadow-none focus-visible:ring-1 bg-white disabled:bg-slate-50 disabled:text-slate-500" value={row.dc} onChange={(e) => handleSolarFieldChange(index, 'dc', e.target.value)} /></TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    </div>
                                </div>
                            </TabsContent>

                            <TabsContent value="uploads" className="mt-0">
                                <div className="border border-slate-200 rounded-b-lg overflow-hidden mt-0 bg-white">
                                    <Table>
                                        <TableHeader className="bg-sidebar">
                                            <TableRow>
                                                <TableHead className="h-10 font-semibold text-white whitespace-nowrap pl-4 w-16">#</TableHead>
                                                <TableHead className="h-10 font-semibold text-white whitespace-nowrap">Wind Mill Number</TableHead>
                                                <TableHead className="h-10 font-semibold text-white whitespace-nowrap w-1/3">Upload Files</TableHead>
                                                <TableHead className="h-10 font-semibold text-white whitespace-nowrap w-1/3">File Name</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {windmillNumbers.map((wm, index) => (
                                                <TableRow key={index} className="hover:bg-slate-50 border-b border-slate-100">
                                                    <TableCell className="py-3 text-sm text-slate-700 font-medium pl-4">{index + 1}</TableCell>
                                                    <TableCell className="py-3 text-sm text-slate-700 font-medium">{wm}</TableCell>
                                                    <TableCell className="py-3 text-sm text-slate-700">
                                                        <div className="flex items-center gap-2 max-w-sm">
                                                            <Input
                                                                type="file"
                                                                onChange={(e) => handleFileUpload(wm, e.target.files ? e.target.files[0] : null)}
                                                                className="bg-white border-slate-300 h-9 text-xs focus:ring-blue-500 file:mr-4 file:py-1 file:px-2 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100"
                                                            />
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="py-3 text-sm text-slate-600">
                                                        {uploads[wm]?.fileName ? (
                                                            <a
                                                                href={uploads[wm]?.file ? URL.createObjectURL(uploads[wm].file!) : "#"}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                                                            >
                                                                {uploads[wm].fileName}
                                                            </a>
                                                        ) : (
                                                            <span className="text-slate-400 italic">No file selected</span>
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </TabsContent>
                        </Tabs>
                    </div>
                </div>
            </div>
            </div>
        </ErrorBoundary>
    );
}
