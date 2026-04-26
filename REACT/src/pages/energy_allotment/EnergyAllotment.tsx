import React, { useState, useEffect, useMemo } from "react";
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
import { utils, writeFile } from "xlsx";

const allotmentData = [];




// Solar Data: 2 Customers, listed by SE Number
const initialSolarData = [];



type ChargeRow = {
    windmill: string;
    customer: string;
    seNumber: string;
    mrc: number; omc: number; trc: number; oc1: number; kp: number; ec: number; shc: number; other: number; dc: number;
};

type SolarRow = {
    chargeKey: string;
    chargeLabel: string;
    customer: string;
    seNumber: string;
    isChecked: boolean;
    value: number;
};



const createInitialSolarRows = (labels: Record<string, string>): SolarRow[] => {
    const chargeKeys = ['mrc', 'omc', 'trc', 'oc1', 'kp', 'ec', 'shc', 'other', 'dc'];
    return chargeKeys.map(key => ({
        chargeKey: key,
        chargeLabel: labels[key] || key.toUpperCase(),
        customer: "",
        seNumber: "",
        isChecked: false,
        value: 0
    }));
};



export default function EnergyAllotment() {
    const { open } = useSidebar();
    const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
    const [selectedMonth, setSelectedMonth] = useState<string>((new Date().getMonth() + 1).toString());
    const [searchKeyword, setSearchKeyword] = useState("");
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const [activeTab, setActiveTab] = useState("list");
    const [selectedWindmillId, setSelectedWindmillId] = useState<string>("");
    // Dynamic lists for dropdowns
    const [customerList, setCustomerList] = useState<string[]>([]);
    const [customerSEMap, setCustomerSEMap] = useState<Record<string, string[]>>({});
    const [fullCustomerData, setFullCustomerData] = useState<any[]>([]);


    // State for Uploads
    const [uploads, setUploads] = useState<Record<string, { file: File | null, fileName: string, filePath?: string }>>({});

    // Dynamic Charge Names from Master
    const [chargeLabels, setChargeLabels] = useState<Record<string, string>>({
        mrc: "M.R.C",
        omc: "O.M.C",
        trc: "T.R.C",
        oc1: "O.C",
        kp: "K.P",
        ec: "E.C",
        shc: "S.H.C",
        other: "O.C",
        dc: "D.C"
    });

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

    const handleAllotmentOrderUpload = (wm: string, file: File | null) => {
        if (!file) {
            setUploads(prev => ({ ...prev, [wm]: { file: null, fileName: "" } }));
            return;
        }

        // Update local file state for UI
        setUploads(prev => ({
            ...prev,
            [wm]: { file, fileName: file.name }
        }));
    };

    // Fetch Allotment Orders when month/year changes
    useEffect(() => {
        const fetchAllotmentOrders = async () => {
            try {
                const response = await api.get(`/windmills/allotment-order/list?year=${selectedYear}&month=${selectedMonth}`);
                if (response.data && response.data.status === "success") {
                    const orders = response.data.data;
                    const newUploads: Record<string, { file: File | null, fileName: string, filePath?: string }> = {};
                    orders.forEach((order: any) => {
                        // Assuming the API returns windmill_number or we map it
                        // The SP sp_get_allotment_orders usually returns windmill_number, file_name, file_path
                        if (order.windmill_number && order.file_name) {
                            newUploads[order.windmill_number] = {
                                file: null,
                                fileName: order.file_name,
                                filePath: order.file_path
                            };
                        }
                    });
                    setUploads(newUploads);
                } else {
                    setUploads({});
                }
            } catch (error) {
                console.error("Error fetching allotment orders:", error);
                setUploads({});
            }
        };

        if (selectedYear && selectedMonth) {
            fetchAllotmentOrders();
        }
    }, [selectedYear, selectedMonth]);

    // State for Charge Allocation (8 windmills)

    // State for Dynamic Windmill Headers
    const [windmillNumbers, setWindmillNumbers] = useState<string[]>(["WM-001", "WM-002", "WM-003", "WM-004", "WM-005", "WM-006", "WM-007", "WM-008", "SOLAR-001"]);
    const [windmillsDetailed, setWindmillsDetailed] = useState<any[]>([]);

    useEffect(() => {
        const fetchWindmills = async () => {
            try {
                const response = await api.get("/windmills/active-posted");
                if (Array.isArray(response.data)) {
                    const numbers = Array.from(new Set(response.data.map((item: any) => String(item.windmill_number || '').trim()))).filter(Boolean);
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

    const [isFetchingCharges, setIsFetchingCharges] = useState(false);
    const [fetchedChargesSummary, setFetchedChargesSummary] = useState<Record<string, any>>({});
    const [chargeAllocationRows, setChargeAllocationRows] = useState<ChargeRow[]>([]);

    useEffect(() => {
        const fetchPreviousCharges = async () => {
            if (!selectedMonth || !selectedYear || windmillNumbers.length === 0) return;

            setIsFetchingCharges(true);
            try {
                const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
                let mIdx = parseInt(selectedMonth) - 1;
                let prevMIdx = mIdx - 1;
                let prevYear = parseInt(selectedYear);

                if (prevMIdx < 0) {
                    prevMIdx = 11;
                    prevYear -= 1;
                }

                const prevMonthName = monthNames[prevMIdx];
                console.log(`🔍 Fetching Applicable Charges for PREVIOUS month ${prevYear}-${prevMonthName}...`);

                // Fetch both applicable charges and saved charges in parallel
                const [applicableRes, savedRes] = await Promise.all([
                    api.get(`/eb/applicable-charges/summary?year=${prevYear}&month=${prevMonthName}`),
                    api.get(`/windmills/charge-allotment/all-by-month?year=${selectedYear}&month=${selectedMonth}`)
                ]);

                let chargesMap: Record<string, any> = {};
                if (applicableRes.data && applicableRes.data.status === "success") {
                    chargesMap = applicableRes.data.data;
                    setFetchedChargesSummary(chargesMap);
                }

                let savedWindmills: any[] = [];
                if (savedRes.data && savedRes.data.status === "success") {
                    savedWindmills = savedRes.data.windmill_charges || [];
                }

                setChargeAllocationRows(windmillNumbers.map(wm => {
                    const saved = savedWindmills.find((s: any) => s.windmill === wm);
                    if (saved) {
                        return {
                            windmill: wm,
                            customer: saved.customer || "",
                            seNumber: saved.seNumber || "",
                            mrc: saved.mrc || 0,
                            omc: saved.omc || 0,
                            trc: saved.trc || 0,
                            oc1: saved.oc1 || 0,
                            kp: saved.kp || 0,
                            ec: saved.ec || 0,
                            shc: saved.shc || 0,
                            other: saved.other || 0,
                            dc: saved.dc || 0,
                        };
                    } else {
                        const wmCharges = chargesMap[wm] || {};
                        return {
                            windmill: wm,
                            customer: "",
                            seNumber: "",
                            mrc: wmCharges["C001"] || 0,
                            omc: wmCharges["C002"] || 0,
                            trc: wmCharges["C003"] || 0,
                            oc1: wmCharges["C004"] || 0,
                            kp: wmCharges["C005"] || 0,
                            ec: wmCharges["C006"] || 0,
                            shc: wmCharges["C007"] || 0,
                            other: wmCharges["C008"] || 0,
                            dc: wmCharges["C010"] || 0,
                        };
                    }
                }));

            } catch (error) {
                console.error("Error fetching previous month charges:", error);
                setChargeAllocationRows(windmillNumbers.map(wm => ({
                    windmill: wm, customer: "", seNumber: "",
                    mrc: 0, omc: 0, trc: 0, oc1: 0, kp: 0, ec: 0, shc: 0, other: 0, dc: 0,
                })));
            } finally {
                setIsFetchingCharges(false);
            }
        };

        fetchPreviousCharges();
    }, [selectedYear, selectedMonth, windmillNumbers]);

    // State for Solar Allocation
    const [solarAllocationRows, setSolarAllocationRows] = useState<SolarRow[]>(createInitialSolarRows(chargeLabels));

    // State for Energy Allotment List
    const [energyAllotmentData, setEnergyAllotmentData] = useState<(typeof allotmentData[0] & Record<string, any>)[]>(allotmentData);
    const [consumptionRequests, setConsumptionRequests] = useState<any[]>([]);
    const [ebSummaryData, setEbSummaryData] = useState<Record<string, any>>({});
    const [solarWindmills, setSolarWindmills] = useState<any[]>([]);

    // Memoized Grid Logic for high performance
    const memoizedGridData = useMemo(() => {
        // 1. Filter by keyword
        const filtered = energyAllotmentData.filter(item => {
            if (!searchKeyword) return true;
            const kw = searchKeyword.toLowerCase();
            return (
                String(item.customer || '').toLowerCase().includes(kw) ||
                String(item.seNumber || '').toLowerCase().includes(kw) ||
                String(item.wm || '').toLowerCase().includes(kw)
            );
        });

        // 2. Group by Customer and SE
        const grouped: Record<string, Set<string>> = {};
        filtered.forEach(item => {
            const cust = String(item.customer || '').trim();
            if (!grouped[cust]) grouped[cust] = new Set();
            grouped[cust].add(item.seNumber);
        });

        // 3. Flat list for index-based calculations
        const order: { customer: string, seNumber: string }[] = [];
        Object.keys(grouped).sort().forEach(c => {
            Array.from(grouped[c]).sort().forEach(se => {
                order.push({ customer: c, seNumber: se });
            });
        });

        // 4. Pre-calculate Cumulative Allotments for O(1) lookups in grid cells
        // cumulativeMap[wm][col][rowIndex] = sum of allocations for all rows before rowIndex
        const cumulativeMap: Record<string, Record<string, number[]>> = {};

        windmillNumbers.forEach(wm => {
            cumulativeMap[wm] = { c1: [0], c2: [0], c4: [0], c5: [0] };

            // Temporary index for O(1) lookup of items in filtered data
            const itemMap = new Map();
            filtered.filter(d => d.wm === wm).forEach(d => {
                itemMap.set(`${String(d.customer || '').trim()}-${d.seNumber}`, d);
            });

            order.forEach((r, idx) => {
                const item = itemMap.get(`${r.customer}-${r.seNumber}`);
                ['c1', 'c2', 'c4', 'c5'].forEach(slot => {
                    const val = Number(String(item?.[slot] || '0').replace(/,/g, '')) || 0;
                    cumulativeMap[wm][slot][idx + 1] = cumulativeMap[wm][slot][idx] + val;
                });
            });
        });

        return { filtered, grouped, order, cumulativeMap };
    }, [energyAllotmentData, searchKeyword, windmillNumbers]);

    useEffect(() => {
        const fetchSolarWindmills = async () => {
            try {
                const response = await api.get("/eb-solar/windmills");
                if (response.data && response.data.status === "success") {
                    setSolarWindmills(response.data.data);
                }
            } catch (error) {
                console.error("Error fetching solar windmills:", error);
            }
        };
        fetchSolarWindmills();
    }, []);

    useEffect(() => {
        const fetchConsumption = async () => {
            try {
                // Calculate previous month for "Requested" values
                let prevMonth = parseInt(selectedMonth) - 1;
                let prevYear = parseInt(selectedYear);
                if (prevMonth === 0) {
                    prevMonth = 12;
                    prevYear -= 1;
                }

                console.log(`🔍 Fetching consumption requests for PREVIOUS month ${prevYear}-${prevMonth}...`);
                const response = await api.get(`/consumption-request/list?year=${prevYear}&month=${prevMonth}`);

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
        const loadAllSolarData = async () => {
            // 1. Fetch labels first
            let currentLabels = { ...chargeLabels };
            try {
                const labelRes = await api.get("/consumption/list");
                if (Array.isArray(labelRes.data)) {
                    labelRes.data.forEach((item: any) => {
                        if (item.charge_code === 'C001') currentLabels.mrc = item.charge_name;
                        if (item.charge_code === 'C002') currentLabels.omc = item.charge_name;
                        if (item.charge_code === 'C003') currentLabels.trc = item.charge_name;
                        if (item.charge_code === 'C004') currentLabels.oc1 = item.charge_name;
                        if (item.charge_code === 'C005') currentLabels.kp = item.charge_name;
                        if (item.charge_code === 'C006') currentLabels.ec = item.charge_name;
                        if (item.charge_code === 'C007') currentLabels.shc = item.charge_name;
                        if (item.charge_code === 'C008') currentLabels.other = item.charge_name;
                        if (item.charge_code === 'C010') currentLabels.dc = item.charge_name;
                    });
                    setChargeLabels(currentLabels);
                }
            } catch (err) {
                console.error("Error loading charge labels:", err);
            }

            // 2. Fetch charges for the previous month
            if (solarWindmills.length === 0) {
                setSolarAllocationRows(createInitialSolarRows(currentLabels));
                return;
            }

            try {
                let prevMonthNum = parseInt(selectedMonth) - 1;
                let prevYear = parseInt(selectedYear);
                if (prevMonthNum === 0) {
                    prevMonthNum = 12;
                    prevYear -= 1;
                }

                console.log(`🔍 Solar Sync: Fetching charges for ${prevYear}-${prevMonthNum}`);
                const [chargeRes, savedRes] = await Promise.all([
                    api.get(`/eb-solar/applicable-charges/summary?year=${prevYear}&month=${prevMonthNum}`),
                    api.get(`/windmills/charge-allotment/all-by-month?year=${selectedYear}&month=${selectedMonth}`)
                ]);

                console.log("🔍 Solar Sync API Response:", chargeRes.data);

                let savedSolar: any[] = [];
                if (savedRes.data && savedRes.data.status === "success") {
                    savedSolar = savedRes.data.solar_charges || [];
                }

                if (chargeRes.data && chargeRes.data.status === "success") {
                    const dataMap = chargeRes.data.data;
                    const solarWm = solarWindmills[0].solar_number;
                    console.log(`🔍 Solar Sync: Matching windmill "${solarWm}"`);
                    const wmCharges = dataMap[solarWm] || {};
                    console.log(`🔍 Solar Sync: Found charges:`, wmCharges);

                    const initialRows = createInitialSolarRows(currentLabels).map(row => {
                        let code = "";
                        if (row.chargeKey === 'mrc') code = 'C001';
                        if (row.chargeKey === 'omc') code = 'C002';
                        if (row.chargeKey === 'trc') code = 'C003';
                        if (row.chargeKey === 'oc1') code = 'C004';
                        if (row.chargeKey === 'kp') code = 'C005';
                        if (row.chargeKey === 'ec') code = 'C006';
                        if (row.chargeKey === 'shc') code = 'C007';
                        if (row.chargeKey === 'other') code = 'C008';
                        if (row.chargeKey === 'dc') code = 'C010';

                        const savedRow = savedSolar.find((s: any) => s.charge_code === code);
                        if (savedRow) {
                            return {
                                ...row,
                                customer: savedRow.customer || "",
                                seNumber: savedRow.seNumber || "",
                                value: savedRow.value || 0,
                                isChecked: true
                            };
                        }

                        const val = wmCharges[code] || 0;
                        return {
                            ...row,
                            value: val,
                            isChecked: val > 0
                        };
                    });
                    setSolarAllocationRows(initialRows);
                } else {
                    const fallbackRows = createInitialSolarRows(currentLabels).map(row => {
                        let code = "";
                        if (row.chargeKey === 'mrc') code = 'C001';
                        if (row.chargeKey === 'omc') code = 'C002';
                        if (row.chargeKey === 'trc') code = 'C003';
                        if (row.chargeKey === 'oc1') code = 'C004';
                        if (row.chargeKey === 'kp') code = 'C005';
                        if (row.chargeKey === 'ec') code = 'C006';
                        if (row.chargeKey === 'shc') code = 'C007';
                        if (row.chargeKey === 'other') code = 'C008';
                        if (row.chargeKey === 'dc') code = 'C010';

                        const savedRow = savedSolar.find((s: any) => s.charge_code === code);
                        if (savedRow) {
                            return {
                                ...row,
                                customer: savedRow.customer || "",
                                seNumber: savedRow.seNumber || "",
                                value: savedRow.value || 0,
                                isChecked: true
                            };
                        }
                        return row;
                    });
                    setSolarAllocationRows(fallbackRows);
                }
            } catch (error) {
                console.error("Error fetching solar charges:", error);
                setSolarAllocationRows(createInitialSolarRows(currentLabels));
            }
        };

        loadAllSolarData();
    }, [selectedYear, selectedMonth, solarWindmills]);

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

                    // Populate dynamic dropdowns for Charge Allocation
                    const uniqueCustomers = Array.from(new Set(response.data.map((item: any) => item.customer_name || item.customer))).filter(Boolean) as string[];
                    setCustomerList(uniqueCustomers);

                    const seMap: Record<string, string[]> = {};
                    response.data.forEach((item: any) => {
                        const name = item.customer_name || item.customer;
                        const se = item.service_number || item.sc_number;
                        if (name && se) {
                            if (!seMap[name]) seMap[name] = [];
                            if (!seMap[name].includes(se)) seMap[name].push(se);
                        }
                    });
                    setCustomerSEMap(seMap);
                    setFullCustomerData(response.data);

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
            console.log(`🔍 Fetching EB Statement P/B values for allotment month ${selectedYear}-${selectedMonth}...`);
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

    useEffect(() => {
        if (!selectedYear || !selectedMonth) return;

        const autoLoadAllAllotments = async () => {
            try {
                const response = await api.get(
                    `/windmills/energy-allotment/all-by-month?year=${selectedYear}&month=${selectedMonth}`
                );

                if (response.data && response.data.status === "success") {
                    const savedData: any[] = response.data.data;
                    setEnergyAllotmentData(prev => {
                        // 1. Create a skeleton of unique (Customer, SE) from the current state
                        const skeletonMap = new Map();
                        prev.forEach(d => {
                            const cid = d.customer_id || 0;
                            const sid = d.service_id || 0;
                            const key = `${cid}-${sid}`;
                            if (!skeletonMap.has(key)) {
                                skeletonMap.set(key, {
                                    ...d,
                                    wm: "",
                                    c1: "0", c1_pp: "0", c1_bank: "0", c1_allot: "0",
                                    c2: "0", c2_pp: "0", c2_bank: "0", c2_allot: "0",
                                    c4: "0", c4_pp: "0", c4_bank: "0", c4_allot: "0",
                                    c5: "0", c5_pp: "0", c5_bank: "0", c5_allot: "0",
                                });
                            }
                        });

                        const resultRows: any[] = Array.from(skeletonMap.values());
                        if (savedData.length === 0) return resultRows;

                        // 2. Distribute savedData into the skeleton
                        savedData.forEach((s: any) => {
                            const cid = s.customer_id || 0;
                            const sid = s.service_id || 0;
                            const key = `${cid}-${sid}`;
                            const wm = String(s.windmill_number || '').trim();

                            // Try to find a row for this customer that hasn't been assigned a windmill yet
                            const emptyIdx = resultRows.findIndex(r =>
                                String(`${r.customer_id || 0}-${r.service_id || 0}`) === key && r.wm === ""
                            );

                            if (emptyIdx >= 0) {
                                // Update the empty skeleton row
                                resultRows[emptyIdx] = {
                                    ...resultRows[emptyIdx],
                                    wm: wm,
                                    c1: String(s.c1 || '0'), c1_pp: String(s.c1_pp || '0'), c1_bank: String(s.c1_bank || '0'), c1_allot: String(s.c1 || '0'),
                                    c2: String(s.c2 || '0'), c2_pp: String(s.c2_pp || '0'), c2_bank: String(s.c2_bank || '0'), c2_allot: String(s.c2 || '0'),
                                    c4: String(s.c4 || '0'), c4_pp: String(s.c4_pp || '0'), c4_bank: String(s.c4_bank || '0'), c4_allot: String(s.c4 || '0'),
                                    c5: String(s.c5 || '0'), c5_pp: String(s.c5_pp || '0'), c5_bank: String(s.c5_bank || '0'), c5_allot: String(s.c5 || '0'),
                                };
                            } else {
                                // If already assigned, clone the customer's base row and append for the additional windmill
                                const base = resultRows.find(r => String(`${r.customer_id || 0}-${r.service_id || 0}`) === key);
                                if (base) {
                                    resultRows.push({
                                        ...base,
                                        wm: wm,
                                        c1: String(s.c1 || '0'), c1_pp: String(s.c1_pp || '0'), c1_bank: String(s.c1_bank || '0'), c1_allot: String(s.c1 || '0'),
                                        c2: String(s.c2 || '0'), c2_pp: String(s.c2_pp || '0'), c2_bank: String(s.c2_bank || '0'), c2_allot: String(s.c2 || '0'),
                                        c4: String(s.c4 || '0'), c4_pp: String(s.c4_pp || '0'), c4_bank: String(s.c4_bank || '0'), c4_allot: String(s.c4 || '0'),
                                        c5: String(s.c5 || '0'), c5_pp: String(s.c5_pp || '0'), c5_bank: String(s.c5_bank || '0'), c5_allot: String(s.c5 || '0'),
                                    });
                                }
                            }
                        });
                        return resultRows;
                    });

                    console.log(`✅ Auto-loaded ${savedData.length} allotment rows for ${selectedMonth}/${selectedYear}`);
                }
            } catch (error) {
                console.error("❌ Auto-load allotments error:", error);
            }
        };

        autoLoadAllAllotments();
    }, [selectedYear, selectedMonth]);

    const handleSearch = async () => {
        if (!selectedWindmillId) {
            toast.error("Please select a windmill first.");
            return;
        }

        toast.info("Fetching Windmill EB Statement details and saved allotments...");

        try {
            // 1. Fetch Availability (P/B rows)
            await fetchEbStatementSummary();

            // 2. Fetch Saved Allotments for the Grid
            const response = await api.get(`/windmills/energy-allotment/details-list?windmill_id=${selectedWindmillId}&year=${selectedYear}&month=${selectedMonth}`);

            if (response.data && response.data.status === "success") {
                const savedData = response.data.data;

                if (savedData.length > 0) {
                    const windmillObj = windmillsDetailed.find(w => w.id.toString() === selectedWindmillId);
                    const wmNumber = windmillObj?.windmill_number || "";

                    // Update the grid with saved values
                    setEnergyAllotmentData(prev => {
                        const newData = [...prev];
                        savedData.forEach((savedRow: any) => {
                            const index = newData.findIndex(d =>
                                d.customer_id === savedRow.customer_id &&
                                d.service_id === savedRow.service_id
                            );

                            if (index >= 0) {
                                // Important: We update/create a row for this specific windmill
                                // If a row for this customer/service/wm already exists, update it.
                                // If not, we might need to handle multi-wm rows better, but 
                                // usually the grid is pre-populated with customers.
                                const existingRowIndex = newData.findIndex(d =>
                                    d.customer_id === savedRow.customer_id &&
                                    d.service_id === savedRow.service_id &&
                                    d.wm === wmNumber
                                );

                                if (existingRowIndex >= 0) {
                                    newData[existingRowIndex] = {
                                        ...newData[existingRowIndex],
                                        c1: savedRow.c1.toString(),
                                        c1_pp: savedRow.c1_pp.toString(),
                                        c1_bank: savedRow.c1_bank.toString(),
                                        c1_allot: savedRow.c1.toString(),
                                        c2: savedRow.c2.toString(),
                                        c2_pp: savedRow.c2_pp.toString(),
                                        c2_bank: savedRow.c2_bank.toString(),
                                        c2_allot: savedRow.c2.toString(),
                                        c4: savedRow.c4.toString(),
                                        c4_pp: savedRow.c4_pp.toString(),
                                        c4_bank: savedRow.c4_bank.toString(),
                                        c4_allot: savedRow.c4.toString(),
                                        c5: savedRow.c5.toString(),
                                        c5_pp: savedRow.c5_pp.toString(),
                                        c5_bank: savedRow.c5_bank.toString(),
                                        c5_allot: savedRow.c5.toString(),
                                    };
                                } else {
                                    // If row doesn't exist for this WM, we could add it, 
                                    // but let's just update the first one found or handle as needed.
                                    // For now, let's assume rows are keyed by (customer, service, wm)
                                    newData[index] = {
                                        ...newData[index],
                                        wm: wmNumber,
                                        c1: savedRow.c1.toString(),
                                        c1_pp: savedRow.c1_pp.toString(),
                                        c1_bank: savedRow.c1_bank.toString(),
                                        c1_allot: savedRow.c1.toString(),
                                        c2: savedRow.c2.toString(),
                                        c2_pp: savedRow.c2_pp.toString(),
                                        c2_bank: savedRow.c2_bank.toString(),
                                        c2_allot: savedRow.c2.toString(),
                                        c4: savedRow.c4.toString(),
                                        c4_pp: savedRow.c4_pp.toString(),
                                        c4_bank: savedRow.c4_bank.toString(),
                                        c4_allot: savedRow.c4.toString(),
                                        c5: savedRow.c5.toString(),
                                        c5_pp: savedRow.c5_pp.toString(),
                                        c5_bank: savedRow.c5_bank.toString(),
                                        c5_allot: savedRow.c5.toString(),
                                    };
                                }
                            }
                        });
                        return newData;
                    });
                    toast.success("Loaded saved allotments!");
                } else {
                    toast.info("No saved allotments found for this selection.");
                }
            }
        } catch (error) {
            console.error("Search error:", error);
            toast.error("Failed to fetch search results.");
        }
    };

    const handleSave = async () => {
        if (isSaving) return;

        setIsSaving(true);
        try {
            // Check for pending uploads if active tab is uploads
            if (activeTab === "uploads") {
                const pendingUploads = Object.entries(uploads).filter(([wm, data]) => data.file !== null);

                if (pendingUploads.length === 0) {
                    toast.warning("ℹ️ No new files to save. Please select a file first.");
                    setIsSaving(false);
                    return;
                }

                let successCount = 0;
                let errorCount = 0;

                for (const [wm, data] of pendingUploads) {
                    const windmillObj = windmillsDetailed.find(w => w.windmill_number === wm);
                    if (!windmillObj) {
                        toast.error(`Windmill ID not found for ${wm}`);
                        errorCount++;
                        continue;
                    }

                    try {
                        toast.info(`Saving Allotment Order for ${wm}...`);
                        const formData = new FormData();
                        formData.append("windmill_id", windmillObj.id.toString());
                        formData.append("year", selectedYear);
                        formData.append("month", selectedMonth);
                        formData.append("file", data.file!);

                        const response = await api.post("/windmills/allotment-order/upload", formData, {
                            headers: { "Content-Type": "multipart/form-data" }
                        });

                        if (response.data && response.data.status === "success") {
                            successCount++;
                            // Clear the `file` object to mark it as saved and store filePath
                            setUploads(prev => ({
                                ...prev,
                                [wm]: { file: null, fileName: response.data.file_name, filePath: response.data.file_path }
                            }));
                        } else {
                            errorCount++;
                        }
                    } catch (error: any) {
                        console.error(`Allotment order upload error for ${wm}:`, error);
                        let errMsg = `Failed to upload for ${wm}.`;
                        if (error.response?.data?.detail) {
                            const detail = error.response.data.detail;
                            if (typeof detail === 'string') errMsg = detail;
                            else if (Array.isArray(detail)) errMsg = detail.map((err: any) => err.msg).join(", ");
                        }
                        toast.error(errMsg);
                        errorCount++;
                    }
                }

                if (successCount > 0) {
                    toast.success(`✅ ${successCount} files saved successfully!`);
                }
                if (errorCount > 0) {
                    toast.error(`❌ Failed to save ${errorCount} files.`);
                }

                setIsSaving(false);
                return;
            }
            if (!energyAllotmentData || energyAllotmentData.length === 0) {
                toast.error("No data available");
                setIsSaving(false);
                return;
            }

            let successCount = 0;
            let errorCount = 0;
            let skippedCount = 0;

            // 1. Identify rows with data across all three modules
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

            const windmillChargesToSave = chargeAllocationRows.filter(r => r.customer && r.seNumber);
            const solarRowsToSave = solarAllocationRows.filter(r => r.customer && r.seNumber && r.isChecked);

            // Block save only for non-list tabs when nothing to save
            if (activeTab !== "list" && rowsWithData.length === 0 && windmillChargesToSave.length === 0 && solarRowsToSave.length === 0) {
                toast.warning("ℹ️ No rows with data. Fill in at least one field to save.");
                setIsSaving(false);
                return;
            }

            if (activeTab === "list") {
                const runningBalance = JSON.parse(JSON.stringify(ebSummaryData));

                if (rowsWithData.length > 0) {
                    for (const row of rowsWithData) {
                        try {
                            const resolvedCustomerId = parseInt(String(
                                row.customer_id || row.id || row.cust_id || row.mc_id || 0
                            )) || 0;

                            if (resolvedCustomerId === 0) {
                                skippedCount++;
                                continue;
                            }

                            const wm = row.wm;
                            const windmillObj = windmillsDetailed.find(w => w.windmill_number === wm);
                            const resolvedWindmillId = ebSummaryData[wm]?.windmill_id || windmillObj?.id || 0;

                            const slots = ['c1', 'c2', 'c4', 'c5'];
                            const splitValues: any = {};

                            slots.forEach(slot => {
                                const totalAlloc = parseFloat(row[slot]) || 0;
                                const oldPP = parseFloat(row[`${slot}_pp`]) || 0;
                                const oldBank = parseFloat(row[`${slot}_bank`]) || 0;

                                let availablePP = (parseFloat(runningBalance[wm]?.[`${slot}_pp`]) || 0) + oldPP;
                                let utilizedPP = Math.min(totalAlloc, availablePP);
                                let remaining = totalAlloc - utilizedPP;

                                let availableBank = (parseFloat(runningBalance[wm]?.[`${slot}_bank`]) || 0) + oldBank;
                                let utilizedBank = Math.min(remaining, availableBank);

                                splitValues[`${slot}_power`] = utilizedPP;
                                splitValues[`${slot}_banking`] = utilizedBank;

                                if (runningBalance[wm]) {
                                    runningBalance[wm][`${slot}_pp`] = (availablePP - utilizedPP);
                                    runningBalance[wm][`${slot}_bank`] = (availableBank - utilizedBank);
                                }
                            });

                            const payload = {
                                allotment_year: parseInt(selectedYear),
                                allotment_month: parseInt(selectedMonth),
                                allotment_date: new Date().toISOString().split('T')[0],
                                customer_id: resolvedCustomerId,
                                windmill_id: resolvedWindmillId,
                                service_id: row.service_id || 0,
                                service_number: row.seNumber ? String(row.seNumber).trim() : null,
                                c1_power: splitValues.c1_power,
                                c1_banking: splitValues.c1_banking,
                                c2_power: splitValues.c2_power,
                                c2_banking: splitValues.c2_banking,
                                c4_power: splitValues.c4_power,
                                c4_banking: splitValues.c4_banking,
                                c5_power: splitValues.c5_power,
                                c5_banking: splitValues.c5_banking,
                                requested_power: parseFloat(row.consumption) || 0,
                                requested_banking: 0,
                                allocated_power: parseFloat(row.c1_allot) || 0,
                                allocated_banking: 0,
                                utilized_power: 0,
                                utilized_banking: 0
                            };

                            const response = await api.post("/windmills/energy-allotment/create", payload);
                            if (response.status === 200 || response.data?.status === "success") {
                                successCount++;
                            } else {
                                errorCount++;
                            }
                        } catch (rowError: any) {
                            console.error("❌ Exception for row:", row.customer, rowError);
                            errorCount++;
                        }
                    }

                    setEnergyAllotmentData(prev => prev.map(row => ({
                        ...row,
                        c1_allot: row.c1,
                        c2_allot: row.c2,
                        c4_allot: row.c4,
                        c5_allot: row.c5
                    })));
                }

                // 3. Final Balance Sync (Always runs to capture manual edits or final calculated state)
                const windmillNumbers = Object.keys(ebSummaryData);
                if (windmillNumbers.length > 0) {
                    try {
                        const balancePayload = {
                            windmill_id: parseInt(selectedWindmillId || "0"),
                            year: parseInt(selectedYear),
                            month: parseInt(selectedMonth),
                            balances: windmillNumbers.flatMap(wm => ['c1', 'c2', 'c4', 'c5'].map(slot => {
                                const currentPP = parseFloat(ebSummaryData[wm]?.[`${slot}_pp`]) || 0;
                                const currentBank = parseFloat(ebSummaryData[wm]?.[`${slot}_bank`]) || 0;

                                const wmItems = energyAllotmentData.filter(row => row.wm === wm);
                                const totalAllocated = wmItems.reduce((acc, curr) => acc + (parseFloat(String(curr[slot]).replace(/,/g, '')) || 0), 0);
                                const totalSaved = wmItems.reduce((acc, curr) => acc + (parseFloat(String(curr[`${slot}_allot`] || '0').replace(/,/g, '')) || 0), 0);

                                // Calculate Net Change in allotment for this session
                                const diff = totalAllocated - totalSaved;

                                let remainingPP = currentPP;
                                let remainingBank = currentBank;

                                if (diff > 0) {
                                    // Allotting MORE: subtract from PP first, then Bank
                                    const fromPP = Math.min(diff, remainingPP);
                                    remainingPP -= fromPP;
                                    remainingBank = Math.max(remainingBank - (diff - fromPP), 0);
                                } else if (diff < 0) {
                                    // Allotting LESS: return units to PP
                                    remainingPP += Math.abs(diff);
                                }

                                return {
                                    wm,
                                    slot,
                                    pp: Math.round(remainingPP),
                                    bank: Math.round(remainingBank)
                                };
                            }))
                        };
                        await api.post("/windmills/energy-allotment/update-balance", balancePayload);
                        console.log("✅ Final balances synced to database successfully.");
                    } catch (balError) {
                        console.error("❌ Failed to sync final balances:", balError);
                        if (successCount > 0) toast.error("Allotments saved, but balance sync failed.");
                    }
                }
                await fetchEbStatementSummary();
            } else if (activeTab === "allocation") {
                // -------------------------------------------------------
                // 2. Save Windmill Charge Allocation Table
                // -------------------------------------------------------
                if (windmillChargesToSave.length > 0) {
                    console.log("💾 Saving Windmill Charge Allocation rows...");
                    for (const row of windmillChargesToSave) {
                        const match = fullCustomerData.find(c =>
                            (c.customer_name === row.customer || c.customer === row.customer) &&
                            (c.service_number === row.seNumber || c.sc_number === row.seNumber)
                        );

                        const wmObj = windmillsDetailed.find(w => w.windmill_number === row.windmill);

                        if (match) {
                            const chargePayload = {
                                customer_id: match.id || match.customer_id || 0,
                                windmill_id: wmObj?.id || 0,
                                service_id: match.service_id || 0,
                                allotment_year: parseInt(selectedYear),
                                allotment_month: parseInt(selectedMonth),
                                charges: {
                                    C001: row.mrc,
                                    C002: row.omc,
                                    C003: row.trc,
                                    C004: row.oc1,
                                    C005: row.kp,
                                    C006: row.ec,
                                    C007: row.shc,
                                    C008: row.other,
                                    C010: row.dc
                                }
                            };
                            try {
                                await api.post("/windmills/charge-allotment/save", chargePayload);
                                successCount++;
                            } catch (e: any) {
                                console.error(`Error saving windmill charges for ${row.windmill}:`, e);
                                console.error(`  --> Server detail:`, e.response?.data);
                                console.error(`  --> Payload sent:`, chargePayload);
                                errorCount++;
                            }
                        }
                    }
                }

                // -------------------------------------------------------
                // 3. Save Solar Charge Allocation Table
                // -------------------------------------------------------
                if (solarRowsToSave.length > 0) {
                    console.log("💾 Saving Solar Charge Allocation rows...");
                    const solarWm = solarWindmills[0];

                    const items = solarRowsToSave.map(row => {
                        const match = fullCustomerData.find(c =>
                            (c.customer_name === row.customer || c.customer === row.customer) &&
                            (c.service_number === row.seNumber || c.sc_number === row.seNumber)
                        );

                        let code = "";
                        if (row.chargeKey === 'mrc') code = 'C001';
                        else if (row.chargeKey === 'omc') code = 'C002';
                        else if (row.chargeKey === 'trc') code = 'C003';
                        else if (row.chargeKey === 'oc1') code = 'C004';
                        else if (row.chargeKey === 'kp') code = 'C005';
                        else if (row.chargeKey === 'ec') code = 'C006';
                        else if (row.chargeKey === 'shc') code = 'C007';
                        else if (row.chargeKey === 'other') code = 'C008';
                        else if (row.chargeKey === 'dc') code = 'C010';

                        return {
                            charge_code: code,
                            value: row.value,
                            customer_id: match?.id || match?.customer_id || 0,
                            service_id: match?.service_id || 0
                        };
                    });

                    const grouped = items.reduce((acc: any, item: any) => {
                        const key = `${item.customer_id}-${item.service_id}`;
                        if (!acc[key]) acc[key] = { customer_id: item.customer_id, service_id: item.service_id, items: [] };
                        acc[key].items.push({ charge_code: item.charge_code, value: item.value });
                        return acc;
                    }, {});

                    for (const key in grouped) {
                        const group = grouped[key];
                        const solarPayload = {
                            customer_id: group.customer_id,
                            solar_id: solarWm?.id || 0,
                            service_id: group.service_id,
                            allotment_year: parseInt(selectedYear),
                            allotment_month: parseInt(selectedMonth),
                            items: group.items
                        };
                        try {
                            await api.post("/windmills/solar-allotment/save", solarPayload);
                            successCount++;
                        } catch (e: any) {
                            console.error(`Error saving solar group ${key}:`, e);
                            console.error(`  --> Server detail:`, e.response?.data);
                            console.error(`  --> Payload sent:`, solarPayload);
                            errorCount++;
                        }
                    }
                }
            }

            // Final summary
            const summary = `📊 ${activeTab === 'list' ? 'Allotment' : 'Charges'} Saved: ${successCount} | Errors: ${errorCount}`;
            console.log("\n" + summary);

            if (successCount > 0) {
                toast.success(`✅ ${successCount} records saved successfully!`);
                setIsEditing(false);
            } else if (errorCount > 0) {
                toast.error(`❌ Failed to save. Errors: ${errorCount}`);
            }
        } catch (error: any) {
            console.error("❌ Top-level error:", error);
            toast.error("Unexpected error. Check console.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleExportExcel = async () => {
        try {
            const monthLabel = months.find(m => m.value === selectedMonth)?.label || selectedMonth;
            const workbook = utils.book_new();

            if (activeTab === 'allocation') {
                toast.info("Fetching charge allocation data for export...");
                const response = await api.get(
                    `/windmills/charge-allotment/export?year=${selectedYear}&month=${selectedMonth}`
                );

                if (!response.data || response.data.status !== "success") {
                    toast.warning("No charge allocation data found to export.");
                    return;
                }

                const { windmill_charges, solar_charges } = response.data;

                if (windmill_charges.length === 0 && solar_charges.length === 0) {
                    toast.warning("No saved charge data found for the selected period.");
                    return;
                }

                if (windmill_charges.length > 0) {
                    const wsWindmill = utils.json_to_sheet(windmill_charges);
                    const colWidths = Object.keys(windmill_charges[0]).map(key => ({ wch: Math.max(key.length, 14) }));
                    wsWindmill['!cols'] = colWidths;
                    utils.book_append_sheet(workbook, wsWindmill, "Windmill Charges");
                }

                if (solar_charges.length > 0) {
                    const wsSolar = utils.json_to_sheet(solar_charges);
                    const colWidths = Object.keys(solar_charges[0]).map(key => ({ wch: Math.max(key.length, 14) }));
                    wsSolar['!cols'] = colWidths;
                    utils.book_append_sheet(workbook, wsSolar, "Solar Charges");
                }

                const fileName = `Charge_Allocation_${monthLabel}_${selectedYear}.xlsx`;
                writeFile(workbook, fileName);
                toast.success(`✓ Exported charge data to ${fileName}`);

            } else if (activeTab === 'list') {
                toast.info("Fetching allotment data for export...");
                const response = await api.get(
                    `/windmills/energy-allotment/export?year=${selectedYear}&month=${selectedMonth}`
                );

                if (!response.data || response.data.status !== "success") {
                    toast.warning("No allotment data found to export.");
                    return;
                }

                const dataToExport = response.data.data;
                if (dataToExport.length === 0) {
                    toast.warning("No saved allocation data found for the selected period.");
                    return;
                }

                const worksheet = utils.json_to_sheet(dataToExport);
                const colWidths = Object.keys(dataToExport[0]).map(key => ({ wch: Math.max(key.length, 14) }));
                worksheet['!cols'] = colWidths;
                utils.book_append_sheet(workbook, worksheet, "Energy Allotment");

                const fileName = `Energy_Allotment_${monthLabel}_${selectedYear}.xlsx`;
                writeFile(workbook, fileName);
                toast.success(`✓ Exported ${dataToExport.length} records to ${fileName}`);
            } else {
                toast.info("Excel export not available for this tab.");
            }
        } catch (error) {
            console.error("Excel Export Error:", error);
            toast.error("Failed to generate Excel file.");
        }
    };

    const handleChargeCustomerChange = (index: number, customer: string) => {
        setChargeAllocationRows(prev => {
            const newData = [...prev];
            newData[index] = {
                ...newData[index],
                customer,
                seNumber: "",
                mrc: 0, omc: 0, trc: 0, oc1: 0, kp: 0, ec: 0, shc: 0, other: 0, dc: 0
            };
            return newData;
        });
    };

    const handleChargeSEChange = (index: number, seNumber: string) => {
        setChargeAllocationRows(prev => {
            const newData = [...prev];
            const row = newData[index];
            const wm = row.windmill;
            const wmCharges = fetchedChargesSummary[wm] || {};

            newData[index] = {
                ...row,
                seNumber,
                mrc: wmCharges["C001"] || 0,
                omc: wmCharges["C002"] || 0,
                trc: wmCharges["C003"] || 0,
                oc1: wmCharges["C004"] || 0,
                kp: wmCharges["C005"] || 0,
                ec: wmCharges["C006"] || 0,
                shc: wmCharges["C007"] || 0,
                other: wmCharges["C008"] || 0,
                dc: wmCharges["C010"] || 0,
            };
            return newData;
        });
    };


    const handleChargeFieldChange = (index: number, field: string, value: string) => {
        setChargeAllocationRows(prev => {
            const newData = [...prev];
            newData[index] = { ...newData[index], [field]: Number(value) || 0 };
            return newData;
        });
    };

    // Handlers for Solar Allocation
    const handleSolarCheckChange = (index: number, checked: boolean) => {
        const newData = [...solarAllocationRows];
        newData[index] = { ...newData[index], isChecked: checked };
        setSolarAllocationRows(newData);
    };

    const handleSolarFieldChange = (index: number, value: string) => {
        const newData = [...solarAllocationRows];
        newData[index] = { ...newData[index], value: Number(value) || 0 };
        setSolarAllocationRows(newData);
    };

    const handleSolarCustomerChange = (index: number, customer: string) => {
        const newData = [...solarAllocationRows];
        newData[index] = { ...newData[index], customer, seNumber: "" };
        setSolarAllocationRows(newData);
    };

    const handleSolarSEChange = (index: number, seNumber: string) => {
        const newData = [...solarAllocationRows];
        newData[index] = { ...newData[index], seNumber };
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
            const res = Math.max(o - a, 0);
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
                                <Select value={selectedWindmillId} onValueChange={setSelectedWindmillId}>
                                    <SelectTrigger className="w-[200px] h-9 bg-white border-slate-300 text-sm">
                                        <SelectValue placeholder="Select Windmill" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {windmillsDetailed.map(wm => (
                                            <SelectItem key={wm.id} value={wm.id.toString()}>{wm.windmill_number}</SelectItem>
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

                                <Button size="sm" className="h-9 text-sm bg-primary hover:bg-primary/90 text-white px-6 flex items-center gap-2" onClick={handleSearch}>
                                    <Search className="h-4 w-4" />
                                    Search
                                </Button>
                                <Button size="sm" className="h-9 text-sm bg-red-600 hover:bg-red-700 text-white px-4 disabled:opacity-50 disabled:cursor-not-allowed" onClick={handleSave} disabled={isSaving}>
                                    {isSaving ? "Saving..." : "Save"}
                                </Button>
                                <Button size="sm" className="h-9 text-sm bg-slate-500 hover:bg-slate-600 text-white px-4" onClick={() => setIsEditing(false)}>
                                    Cancel
                                </Button>
                                <Button size="sm" className="h-9 text-sm bg-[#DAA520] hover:bg-[#B8860B] text-white px-4" onClick={handleExportExcel}>
                                    Export Excel
                                </Button>
                            </div>
                        </div>

                        {/* Table Section */}
                        <div className="space-y-2">
                            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
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

                                                            const remainingPP = Math.max(totalPP - totalAllocated, 0);
                                                            const spillToBank = Math.max(totalAllocated - totalPP, 0);
                                                            const remainingBank = Math.max(totalBank - spillToBank, 0);

                                                            let displayPower = Math.round(remainingPP);
                                                            let displayBank = Math.round(remainingBank);

                                                            const handleManualUpdate = (col: string, type: 'pp' | 'bank', newVal: string) => {
                                                                const numericVal = parseFloat(newVal) || 0;
                                                                let updatedBase;
                                                                if (type === 'pp') {
                                                                    // We set the base initial balance such that Base - TotalAllocated = numericVal
                                                                    updatedBase = numericVal + totalAllocated;
                                                                } else {
                                                                    // RemainingBank = BaseBank - SpillToBank
                                                                    // BaseBank = RemainingBank + SpillToBank
                                                                    const currentSpill = Math.max(totalAllocated - totalPP, 0);
                                                                    updatedBase = numericVal + currentSpill;
                                                                }

                                                                setEbSummaryData(prev => ({
                                                                    ...prev,
                                                                    [wm]: { ...prev[wm], [`${col}_${type}`]: updatedBase }
                                                                }));
                                                            };

                                                            return (
                                                                <TableHead key={`${wm}-${col}`} className={`p-1 pt-1.5 pb-1 text-xs font-semibold text-white text-center border-r ${isLast ? 'border-white/20 last:border-r-0' : 'border-white/10'} align-bottom`}>
                                                                    <div className="flex flex-col gap-1.5 mb-2 items-start w-fit mx-auto">
                                                                        <div className="flex items-center gap-1.5">
                                                                            <span className="text-xs text-white font-bold w-4 text-right">P:</span>
                                                                            <input
                                                                                type="text"
                                                                                value={displayPower}
                                                                                onChange={(e) => handleManualUpdate(col, 'pp', e.target.value)}
                                                                                className="border border-black px-1 bg-white text-red-500 w-[65px] text-center font-bold h-[24px] text-xs focus:outline-none"
                                                                            />
                                                                        </div>
                                                                        <div className="flex items-center gap-1.5">
                                                                            <span className="text-xs text-white font-bold w-4 text-right">B:</span>
                                                                            <input
                                                                                type="text"
                                                                                value={displayBank}
                                                                                onChange={(e) => handleManualUpdate(col, 'bank', e.target.value)}
                                                                                className="border border-black px-1 bg-white text-red-500 w-[65px] text-center font-bold h-[24px] text-xs focus:outline-none"
                                                                            />
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
                                                    const { filtered: filteredData, grouped: groupedData, order: renderedOrder, cumulativeMap } = memoizedGridData;

                                                    return (
                                                        <React.Fragment>
                                                            {/* Power Plant Row */}
                                                            <TableRow className="bg-[#e0f2fe] border-b border-white hover:bg-[#e0f2fe]">
                                                                <TableCell colSpan={3} className="py-2 text-sm text-[#0369a1] font-bold border-r bg-[#e0f2fe] align-middle sticky left-0 z-20 text-center uppercase tracking-wide">
                                                                    Power Plant
                                                                </TableCell>
                                                                {generators.map((wm) => {
                                                                    const renderC = (col: 'c1' | 'c2' | 'c4' | 'c5') => {
                                                                        const totalPP = ebSummaryData && ebSummaryData[wm] ? Number(ebSummaryData[wm][`${col}_pp`]) || 0 : 0;
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
                                                                    const renderC = (col: 'c1' | 'c2' | 'c4' | 'c5') => {
                                                                        const totalBank = ebSummaryData && ebSummaryData[wm] ? Number(ebSummaryData[wm][`${col}_bank`]) || 0 : 0;
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

                                                            {Object.entries(groupedData).sort().map(([customer, seSet]) => {
                                                                const seList = Array.from(seSet).sort();

                                                                const rows = seList.map((seNumber, seIndex) => {
                                                                    const rowItems = filteredData.filter(d => String(d.customer || '').trim() === customer && d.seNumber === seNumber);
                                                                    const rowTotal = rowItems.reduce((acc, d) => acc + (Number(d.c1) || 0) + (Number(d.c2) || 0) + (Number(d.c4) || 0) + (Number(d.c5) || 0), 0);
                                                                    const totalConsumptionReq = consumptionRequests.find(r => String(r.customer_name || '').trim() === customer && r.sc_number === seNumber);

                                                                    const currentIndex = renderedOrder.findIndex(r => r.customer === customer && r.seNumber === seNumber);

                                                                    const getBalance = (orig: any, totalAlloc: number) => {
                                                                        const o = parseFloat(orig) || 0;
                                                                        const res = Math.max(o - totalAlloc, 0);
                                                                        return res.toFixed(2).replace(/\.00$/, "");
                                                                    };

                                                                    const totalAllocC1 = rowItems.reduce((acc, d) => acc + (parseFloat(d.c1) || 0), 0);
                                                                    const totalAllocC2 = rowItems.reduce((acc, d) => acc + (parseFloat(d.c2) || 0), 0);
                                                                    const totalAllocC4 = rowItems.reduce((acc, d) => acc + (parseFloat(d.c4) || 0), 0);
                                                                    const totalAllocC5 = rowItems.reduce((acc, d) => acc + (parseFloat(d.c5) || 0), 0);

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
                                                                                            <span><span className="text-slate-500">Requested:</span> <span className="text-[#B22222]">{totalConsumptionReq?.total || '0'}</span></span>
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
                                                                                                <Input disabled className="h-7 text-center text-xs px-0" value={balC1} />
                                                                                            </TableCell>
                                                                                            <TableCell className="p-1 border-r text-center">
                                                                                                <Input disabled className="h-7 text-center text-xs px-0" value={balC2} />
                                                                                            </TableCell>
                                                                                            <TableCell className="p-1 border-r text-center">
                                                                                                <Input disabled className="h-7 text-center text-xs px-0" value={balC4} />
                                                                                            </TableCell>
                                                                                            <TableCell className="p-1 border-r text-center">
                                                                                                <Input disabled className="h-7 text-center text-xs px-0" value={balC5} />
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
                                                                                    const item = filteredData.find(d => String(d.customer || '').trim() === customer && String(d.seNumber || '').trim() === String(seNumber || '').trim() && String(d.wm || '').trim() === String(wm || '').trim());
                                                                                    return (
                                                                                        <React.Fragment key={wm}>
                                                                                            <TableCell className="p-1 border-r text-center"><Input className="h-7 text-center text-xs px-0" maxLength={12} value={item ? item.c1 : ''} onChange={(e) => handleGridUpdate(customer, seNumber, wm, 'c1', e.target.value)} /></TableCell>
                                                                                            <TableCell className="p-1 border-r text-center"><Input className="h-7 text-center text-xs px-0" maxLength={12} value={item ? item.c2 : ''} onChange={(e) => handleGridUpdate(customer, seNumber, wm, 'c2', e.target.value)} /></TableCell>
                                                                                            <TableCell className="p-1 border-r text-center"><Input className="h-7 text-center text-xs px-0" maxLength={12} value={item ? item.c4 : ''} onChange={(e) => handleGridUpdate(customer, seNumber, wm, 'c4', e.target.value)} /></TableCell>
                                                                                            <TableCell className="p-1 border-r text-center"><Input className="h-7 text-center text-xs px-0" maxLength={12} value={item ? item.c5 : ''} onChange={(e) => handleGridUpdate(customer, seNumber, wm, 'c5', e.target.value)} /></TableCell>
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
                                                                                    const item = filteredData.find(d => String(d.customer || '').trim() === customer && d.seNumber === seNumber && d.wm === wm);
                                                                                    const getUP = (col: string) => {
                                                                                        if (!item) return '-';
                                                                                        const totalPP = ebSummaryData && ebSummaryData[wm] ? Number(ebSummaryData[wm][`${col}_pp`]) || 0 : 0;
                                                                                        const prevAlloc = cumulativeMap[wm]?.[col]?.[currentIndex] || 0;
                                                                                        let availablePP = Math.max(totalPP - prevAlloc, 0);
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
                                                                                    const item = filteredData.find(d => String(d.customer || '').trim() === customer && d.seNumber === seNumber && d.wm === wm);
                                                                                    const getUB = (col: string) => {
                                                                                        if (!item) return '-';
                                                                                        const totalPP = ebSummaryData && ebSummaryData[wm] ? Number(ebSummaryData[wm][`${col}_pp`]) || 0 : 0;
                                                                                        const totalBank = ebSummaryData && ebSummaryData[wm] ? Number(ebSummaryData[wm][`${col}_bank`]) || 0 : 0;

                                                                                        const prevAlloc = cumulativeMap[wm]?.[col]?.[currentIndex] || 0;
                                                                                        let availablePP = Math.max(totalPP - prevAlloc, 0);
                                                                                        const alloc = Number(String(item[col] || '0').replace(/,/g, ''));
                                                                                        const utilizedPower = Math.min(alloc, availablePP) || 0;

                                                                                        let bankUsedBefore = Math.max(prevAlloc - totalPP, 0);
                                                                                        let availableBank = Math.max(totalBank - bankUsedBefore, 0);
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
                                                                                const stats = filteredData
                                                                                    .filter(d => String(d.customer || '').trim() === customer && d.wm === wm)
                                                                                    .reduce((acc, curr) => {
                                                                                        const c1 = Number(String(curr.c1).replace(/,/g, '')) || 0;
                                                                                        const c2 = Number(String(curr.c2).replace(/,/g, '')) || 0;
                                                                                        const c4 = Number(String(curr.c4).replace(/,/g, '')) || 0;
                                                                                        const c5 = Number(String(curr.c5).replace(/,/g, '')) || 0;

                                                                                        const count = [curr.c1, curr.c2, curr.c4, curr.c5].filter(val => parseFloat(val) > 0).length;

                                                                                        return {
                                                                                            sum: acc.sum + c1 + c2 + c4 + c5,
                                                                                            count: acc.count + count
                                                                                        };
                                                                                    }, { sum: 0, count: 0 });
                                                                                return (
                                                                                    <TableCell key={wm} colSpan={4} className="py-2 text-center font-bold text-indigo-700 text-xs border-r">
                                                                                        <div className="flex flex-col items-center justify-center">
                                                                                            <span className="text-indigo-700 font-bold text-[13px]">{stats.sum}</span>
                                                                                            <span className="text-[10px] text-slate-500 font-medium">({stats.count} entries)</span>
                                                                                        </div>
                                                                                    </TableCell>
                                                                                );
                                                                            })}
                                                                            <TableCell className="py-2 text-center font-bold text-indigo-700 text-xs border-r">
                                                                                {filteredData.filter(d => String(d.customer || '').trim() === customer).reduce((acc, curr) => {
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
                                        <div className="border border-slate-200 rounded-b-lg mt-0 bg-white overflow-x-auto thin-scrollbar" style={{ maxWidth: open ? 'calc(100vw - 18rem)' : 'calc(100vw - 5rem)' }}>
                                            <Table>
                                                <TableHeader className="bg-sidebar">
                                                    <TableRow>
                                                        <TableHead className="py-2 h-10 font-semibold text-white whitespace-nowrap pl-3 text-xs">Windmill No</TableHead>
                                                        <TableHead className="py-2 h-10 font-semibold text-white whitespace-nowrap text-xs">Customer</TableHead>
                                                        <TableHead className="py-2 h-10 font-semibold text-white whitespace-nowrap text-xs">Service Number</TableHead>
                                                        <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap text-xs px-3">{chargeLabels.mrc}</TableHead>
                                                        <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap text-xs px-3">{chargeLabels.omc}</TableHead>
                                                        <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap text-xs px-3">{chargeLabels.trc}</TableHead>
                                                        <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap text-xs px-3">{chargeLabels.oc1}</TableHead>
                                                        <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap text-xs px-3">{chargeLabels.kp}</TableHead>
                                                        <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap text-xs px-3">{chargeLabels.ec}</TableHead>
                                                        <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap text-xs px-3">{chargeLabels.shc}</TableHead>
                                                        <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap text-xs px-3">{chargeLabels.other}</TableHead>
                                                        <TableHead className="py-2 h-10 font-semibold text-white text-right whitespace-nowrap text-xs px-3">{chargeLabels.dc}</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {isFetchingCharges ? (
                                                        <TableRow>
                                                            <TableCell colSpan={12} className="h-24 text-center text-slate-500 italic text-sm">
                                                                <div className="flex flex-col items-center justify-center gap-2">
                                                                    <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                                                                    Fetching previous month charges from EB statements...
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    ) : (
                                                        chargeAllocationRows.map((row, index) => (
                                                            <TableRow key={row.windmill} className="hover:bg-slate-50 border-b border-slate-100 h-10">
                                                                <TableCell className="p-1.5 border-r text-xs text-slate-900 font-bold pl-3 whitespace-nowrap">{row.windmill}</TableCell>
                                                                <TableCell className="p-1.5 border-r min-w-[140px]">
                                                                    <Select value={row.customer} onValueChange={(val) => handleChargeCustomerChange(index, val)}>
                                                                        <SelectTrigger className="h-8 text-xs bg-white border-slate-200 rounded-sm px-2">
                                                                            <SelectValue placeholder="Customer" />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            {customerList.map(c => (
                                                                                <SelectItem key={c} value={c}>{c}</SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                </TableCell>
                                                                <TableCell className="p-1.5 border-r min-w-[130px]">
                                                                    <Select value={row.seNumber} onValueChange={(val) => handleChargeSEChange(index, val)} disabled={!row.customer}>
                                                                        <SelectTrigger className="h-8 text-xs bg-white border-slate-200 rounded-sm px-2">
                                                                            <SelectValue placeholder="Service No" />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            {(customerSEMap[row.customer] || [])
                                                                                .filter(se => {
                                                                                    if (se === row.seNumber) return true;
                                                                                    const isUsed = chargeAllocationRows.some((r, idx) =>
                                                                                        idx !== index &&
                                                                                        r.customer === row.customer &&
                                                                                        r.seNumber === se
                                                                                    );
                                                                                    return !isUsed;
                                                                                })
                                                                                .map(se => (
                                                                                    <SelectItem key={se} value={se}>{se}</SelectItem>
                                                                                ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                </TableCell>
                                                                <TableCell className="p-1.5 border-r"><Input readOnly={!isEditing} className="h-8 text-right text-[11px] border-slate-200 shadow-none focus-visible:ring-1 bg-white text-black font-normal rounded-sm px-2" value={row.mrc} onChange={(e) => handleChargeFieldChange(index, 'mrc', e.target.value)} /></TableCell>
                                                                <TableCell className="p-1.5 border-r"><Input readOnly={!isEditing} className="h-8 text-right text-[11px] border-slate-200 shadow-none focus-visible:ring-1 bg-white text-black font-normal rounded-sm px-2" value={row.omc} onChange={(e) => handleChargeFieldChange(index, 'omc', e.target.value)} /></TableCell>
                                                                <TableCell className="p-1.5 border-r"><Input readOnly={!isEditing} className="h-8 text-right text-[11px] border-slate-200 shadow-none focus-visible:ring-1 bg-white text-black font-normal rounded-sm px-2" value={row.trc} onChange={(e) => handleChargeFieldChange(index, 'trc', e.target.value)} /></TableCell>
                                                                <TableCell className="p-1.5 border-r"><Input readOnly={!isEditing} className="h-8 text-right text-[11px] border-slate-200 shadow-none focus-visible:ring-1 bg-white text-black font-normal rounded-sm px-2" value={row.oc1} onChange={(e) => handleChargeFieldChange(index, 'oc1', e.target.value)} /></TableCell>
                                                                <TableCell className="p-1.5 border-r"><Input readOnly={!isEditing} className="h-8 text-right text-[11px] border-slate-200 shadow-none focus-visible:ring-1 bg-white text-black font-normal rounded-sm px-2" value={row.kp} onChange={(e) => handleChargeFieldChange(index, 'kp', e.target.value)} /></TableCell>
                                                                <TableCell className="p-1.5 border-r"><Input readOnly={!isEditing} className="h-8 text-right text-[11px] border-slate-200 shadow-none focus-visible:ring-1 bg-white text-black font-normal rounded-sm px-2" value={row.ec} onChange={(e) => handleChargeFieldChange(index, 'ec', e.target.value)} /></TableCell>
                                                                <TableCell className="p-1.5 border-r"><Input readOnly={!isEditing} className="h-8 text-right text-[11px] border-slate-200 shadow-none focus-visible:ring-1 bg-white text-black font-normal rounded-sm px-2" value={row.shc} onChange={(e) => handleChargeFieldChange(index, 'shc', e.target.value)} /></TableCell>
                                                                <TableCell className="p-1.5 border-r"><Input readOnly={!isEditing} className="h-8 text-right text-[11px] border-slate-200 shadow-none focus-visible:ring-1 bg-white text-black font-normal rounded-sm px-2" value={row.other} onChange={(e) => handleChargeFieldChange(index, 'other', e.target.value)} /></TableCell>
                                                                <TableCell className="p-1.5 border-r"><Input readOnly={!isEditing} className="h-8 text-right text-[11px] border-slate-200 shadow-none focus-visible:ring-1 bg-white text-black font-normal rounded-sm px-2" value={row.dc} onChange={(e) => handleChargeFieldChange(index, 'dc', e.target.value)} /></TableCell>
                                                            </TableRow>
                                                        ))
                                                    )}
                                                </TableBody>
                                            </Table>
                                        </div>

                                        {/* Solar Allocation Table */}
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2 px-1">
                                                <h3 className="font-bold text-slate-700">SOLAR</h3>
                                                {solarWindmills.length > 0 && (
                                                    <span className="text-sm font-bold text-indigo-700 bg-indigo-50 px-3 py-1 rounded-md border border-indigo-100 shadow-sm ml-1">
                                                        {solarWindmills.map(sw => sw.solar_number).join(', ')}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="border border-slate-200 rounded-lg mt-0 bg-white overflow-x-auto thin-scrollbar" style={{ maxWidth: open ? 'calc(100vw - 18rem)' : 'calc(100vw - 5rem)' }}>
                                                <Table>
                                                    <TableHeader className="bg-sidebar">
                                                        <TableRow>
                                                            <TableHead className="py-2 h-10 font-semibold text-white whitespace-nowrap pl-4">Charges</TableHead>
                                                            <TableHead className="py-2 h-10 font-semibold text-white whitespace-nowrap">Customer</TableHead>
                                                            <TableHead className="py-2 h-10 font-semibold text-white whitespace-nowrap">Service Number</TableHead>
                                                            <TableHead className="py-2 h-10 font-semibold text-white text-center whitespace-nowrap pr-4">Value</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {solarAllocationRows.map((row, index) => (
                                                            <TableRow key={`${index}-${row.chargeKey}`} className="hover:bg-slate-50 border-b border-slate-100">
                                                                <TableCell className="py-2 pl-4 pr-3 text-sm text-slate-700 font-medium w-[240px] border-r">
                                                                    <div className="flex items-center justify-between">
                                                                        <span>{row.chargeLabel}</span>
                                                                        <input
                                                                            type="checkbox"
                                                                            className="accent-indigo-700 h-4 w-4 rounded border-slate-300"
                                                                            checked={row.isChecked}
                                                                            onChange={(e) => handleSolarCheckChange(index, e.target.checked)}
                                                                            disabled={false}
                                                                        />
                                                                    </div>
                                                                </TableCell>
                                                                <TableCell className="p-1.5 w-[180px] border-r">
                                                                    <Select
                                                                        value={row.customer}
                                                                        onValueChange={(val) => handleSolarCustomerChange(index, val)}
                                                                    >
                                                                        <SelectTrigger className="h-8 text-xs border-slate-200 bg-white shadow-none focus:ring-1">
                                                                            <SelectValue placeholder="Select Customer" />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            {customerList.map(cust => (
                                                                                <SelectItem key={cust} value={cust}>{cust}</SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                </TableCell>
                                                                <TableCell className="p-1.5 w-[180px] border-r">
                                                                    <Select
                                                                        value={row.seNumber}
                                                                        onValueChange={(val) => handleSolarSEChange(index, val)}
                                                                        disabled={!row.customer}
                                                                    >
                                                                        <SelectTrigger className="h-8 text-xs border-slate-200 bg-white shadow-none focus:ring-1">
                                                                            <SelectValue placeholder="Select SE Number" />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            {(customerSEMap[row.customer] || []).map(se => (
                                                                                <SelectItem key={se} value={se}>{se}</SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                </TableCell>
                                                                <TableCell className="p-1.5 pr-4">
                                                                    <Input
                                                                        disabled={!isEditing || !row.isChecked}
                                                                        className="h-8 text-center text-xs border-slate-200 shadow-none focus-visible:ring-1 bg-white disabled:bg-white disabled:text-black font-semibold rounded-sm px-2 text-black"
                                                                        value={row.value || ""}
                                                                        onChange={(e) => handleSolarFieldChange(index, e.target.value)}
                                                                    />
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        </div>
                                    </div>
                                </TabsContent>

                                <TabsContent value="uploads" className="mt-0">
                                    <div className="border border-slate-200 rounded-b-lg mt-0 bg-white overflow-x-auto thin-scrollbar" style={{ maxWidth: open ? 'calc(100vw - 18rem)' : 'calc(100vw - 5rem)' }}>
                                        <Table>
                                            <TableHeader className="bg-sidebar">
                                                <TableRow>
                                                    <TableHead className="h-8 py-1 font-semibold text-white whitespace-nowrap pl-4 w-16 text-xs">#</TableHead>
                                                    <TableHead className="h-8 py-1 font-semibold text-white whitespace-nowrap text-xs">Wind Mill Number</TableHead>
                                                    <TableHead className="h-8 py-1 font-semibold text-white whitespace-nowrap w-1/3 text-xs">Upload Files</TableHead>
                                                    <TableHead className="h-8 py-1 font-semibold text-white whitespace-nowrap w-1/3 text-xs">File Name</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {windmillNumbers.map((wm, index) => (
                                                    <TableRow key={index} className="hover:bg-slate-50 border-b border-slate-100 h-10">
                                                        <TableCell className="py-2 text-xs text-slate-700 font-medium pl-4">{index + 1}</TableCell>
                                                        <TableCell className="py-2 text-xs text-slate-700 font-medium">{wm}</TableCell>
                                                        <TableCell className="py-2 text-xs text-slate-700">
                                                            <div className="flex items-center gap-2 max-w-sm">
                                                                <Input
                                                                    type="file"
                                                                    value={uploads[wm]?.file ? undefined : ""}
                                                                    onChange={(e) => handleAllotmentOrderUpload(wm, e.target.files ? e.target.files[0] : null)}
                                                                    className="bg-white border-slate-300 h-8 text-xs focus:ring-blue-500 file:mr-4 file:py-1 file:px-2 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100"
                                                                />
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="py-2 text-xs text-slate-600">
                                                            {uploads[wm]?.fileName ? (
                                                                <a
                                                                    href={uploads[wm]?.file ? URL.createObjectURL(uploads[wm].file!) : uploads[wm]?.filePath ? `http://localhost:8000/${uploads[wm].filePath}` : "#"}
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
