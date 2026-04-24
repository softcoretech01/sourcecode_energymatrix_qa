import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import api from "@/services/api";

// ─────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────
const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen"];
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function numberToWords(num: number): string {
    if (num === 0) return "Zero";
    const crore = Math.floor(num / 10000000);
    const lakh = Math.floor((num % 10000000) / 100000);
    const thousand = Math.floor((num % 100000) / 1000);
    const hundred = Math.floor((num % 1000) / 100);
    const remainder = num % 100;

    const chunk = (n: number): string => {
        if (n === 0) return "";
        if (n < 20) return ones[n] + " ";
        return tens[Math.floor(n / 10)] + " " + (n % 10 ? ones[n % 10] + " " : "");
    };

    let result = "";
    if (crore) result += chunk(crore) + "Crore ";
    if (lakh) result += chunk(lakh) + "Lakh ";
    if (thousand) result += chunk(thousand) + "Thousand ";
    if (hundred) result += ones[hundred] + " Hundred ";
    if (remainder) result += chunk(remainder);
    return result.trim();
}

function formatAmount(n: number): string {
    return new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(n);
}

function formatDate(dateStr: string): string {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const day = d.getDate();
    const month = d.toLocaleString("en-IN", { month: "short" });
    const year = String(d.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
}

// ─────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────
interface InvoiceData {
    id: number;
    invoice_number: number;
    customer_name: string;
    customer_address: string;
    customer_gstin: string;
    customer_city: string;
    service_number: string;
    month: string;
    year: number;
    invoice_date: string;
    amount: number;
    generated_units: number;   // SUM of actual_allotment.allotment_total for this service/year/month
    invoice_constant: number;  // Fetched from masters.configuration
    charge_meter: number;
    charge_om: number;
    charge_trans: number;
    charge_sys_opr: number;
    charge_rkvah: number;
    charge_import: number;
    charge_scheduling: number;
    charge_dsm: number;
    charge_wheeling: number;
    charge_tax: number;
}

export default function ClientInvoicePdf() {
    const { invoice_id } = useParams<{ invoice_id: string }>();
    const navigate = useNavigate();
    const [invoice, setInvoice] = useState<InvoiceData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchInvoice();
    }, [invoice_id]);

    const fetchInvoice = async () => {
        try {
            const res = await api.get(`/invoices/${invoice_id}/print-data`);
            setInvoice(res.data.data);
        } catch (err) {
            console.error("Error fetching invoice:", err);
        } finally {
            setLoading(false);
        }
    };

    // Trigger print only after data is loaded and DOM is rendered
    useEffect(() => {
        if (!loading && invoice) {
            const queryParams = new URLSearchParams(window.location.search);
            if (queryParams.get("print") === "true") {
                const timer = setTimeout(() => {
                    window.print();
                }, 400);
                return () => clearTimeout(timer);
            }
        }
    }, [loading, invoice]);

    const handlePrint = () => window.print();

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <p className="text-slate-500 animate-pulse">Loading invoice...</p>
            </div>
        );
    }

    if (!invoice) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <p className="text-red-500">Invoice not found.</p>
            </div>
        );
    }

    const dMap: Record<string, number> = {};
    if (invoice.details && Array.isArray(invoice.details)) {
        invoice.details.forEach((d: any) => {
            dMap[d.field_name] = Number(d.amount);
        });
    }

    const amount = Number(invoice.amount) || 0;
    const generatedUnits = dMap["Units"] ?? (Number(invoice.generated_units) || 0);
    const RATE_PER_UNIT = dMap["Rate"] ?? (Number(invoice.invoice_constant) || 6.80);
    const energyAmount = generatedUnits * RATE_PER_UNIT;

    // Charges
    const cMeter = dMap["Meter"] ?? (Number(invoice.charge_meter) || 0);
    const cOM = dMap["O&M Charges"] ?? (Number(invoice.charge_om) || 0);
    const cTrans = dMap["Transmsn Chrgs"] ?? (Number(invoice.charge_trans) || 0);
    const cSysOpr = dMap["Sys Opr Chrgs"] ?? (Number(invoice.charge_sys_opr) || 0);
    const cRkvah = dMap["RkvAh"] ?? (Number(invoice.charge_rkvah) || 0);
    const cImport = dMap["Import Chrgs"] ?? (Number(invoice.charge_import) || 0);
    const cSched = dMap["Scheduling chrgs"] ?? (Number(invoice.charge_scheduling) || 0);
    const cDSM = dMap["DSM Charges"] ?? (Number(invoice.charge_dsm) || 0);
    const cWheel = dMap["Wheeling"] ?? (Number(invoice.charge_wheeling) || 0);
    const cTax = dMap["Selfenergy chrgs"] ?? (Number(invoice.charge_tax) || 0);

    // Total charges to subtract
    const totalCharges = cMeter + cOM + cTrans + cSysOpr + cRkvah + cImport + cSched + cDSM + cWheel + cTax;

    const displayAmount = energyAmount - totalCharges;
    const absDisplayAmount = Math.abs(displayAmount);
    const displayAmountWords = numberToWords(Math.round(absDisplayAmount));

    // Build description lines dynamically
    const descLines = [
        `Generated Units for ${invoice.month} ${invoice.year} = ${generatedUnits.toFixed(2)}`,
        `Net Units ${generatedUnits.toLocaleString("en-IN")} x Rs.${RATE_PER_UNIT.toFixed(2)} = Rs.${formatAmount(energyAmount)}`,
        `For SC No.${invoice.service_number}`,
        `(-) Meter = Rs.${formatAmount(cMeter)}`,
        `(-) O&M Charges = Rs.${formatAmount(cOM)}`,
        `(-) Transmsn Chrgs = Rs.${formatAmount(cTrans)}`,
        `(-) Sys Opr Chrgs = Rs.${formatAmount(cSysOpr)}`,
        `(-) RkvAh = Rs.${formatAmount(cRkvah)}`,
        `(-) Import Chrgs = Rs.${formatAmount(cImport)}`,
        `(-) Scheduling chrgs = Rs.${formatAmount(cSched)}`,
        `(-) DSM Charges = Rs.${formatAmount(cDSM)}`,
        `(-) Wheeling = Rs.${formatAmount(cWheel)}`,
        `(-) Selfenergy chrgs = Rs.${formatAmount(cTax)}`,
        `Total = Rs.${formatAmount(totalCharges)}`,
        `Amount = Rs.${formatAmount(absDisplayAmount)}`,
    ];

    return (
        <>
            {/* Print-hide buttons */}
            <style>{`@media print { .no-print { display: none !important; } }`}</style>

            <div className="min-h-screen bg-gray-100 p-6">
                {/* Action Bar */}
                <div className="no-print flex items-center justify-between mb-4 max-w-[210mm] mx-auto">
                    <Button variant="outline" onClick={() => navigate(-1)} className="flex items-center gap-2">
                        <ArrowLeft className="h-4 w-4" /> Back
                    </Button>
                    <Button onClick={handlePrint} className="flex items-center gap-2 bg-[#004d40] hover:bg-[#003d33] text-white">
                        <Printer className="h-4 w-4" /> Print
                    </Button>
                </div>

                {/* ─── A4 Invoice Container ─── */}
                <div className="bg-white mx-auto shadow-lg max-w-[210mm] min-h-[297mm] text-[11px] font-sans border border-gray-300">

                    {/* ══ TITLE ══ */}
                    <div className="text-center py-1 border-b border-gray-400">
                        <span className="font-bold text-sm">Bill of Supply</span>
                    </div>

                    {/* ══ HEADER SECTION: Split Left (Seller/Buyer) and Right (Invoice Details) ══ */}
                    <div className="flex border-b border-gray-400">

                        {/* Left Column — Seller followed by Buyer */}
                        <div className="w-1/2 border-r border-gray-400 flex flex-col">
                            {/* Seller Info */}
                            <div className="p-3 border-b border-gray-400 text-[10.5px] leading-5">
                                <p className="font-bold">New Vision Wind Power Private Limited</p>
                                <p>No. 12 B, Rangasamy Naidu Street,</p>
                                <p>1 St Floor, Above Bank of Baroda</p>
                                <p>Trichy Road, Coimbatore -5</p>
                                <p>TIN :33241885494</p>
                                <p>CST : 1107718/27.06.13</p>
                                <p>3STIN/UIN: 33AAECN2387E1ZM</p>
                                <p>State Name &nbsp;: Tamil Nadu, Code : 33</p>
                            </div>

                            {/* Buyer Info */}
                            <div className="p-3 text-[10.5px] leading-5 flex-1">
                                <p className="font-semibold text-[10px] text-gray-500 mb-0.5 uppercase">Buyer (Bill to)</p>
                                <p className="font-bold">{invoice.customer_name}</p>
                                {invoice.customer_address && <p>{invoice.customer_address}</p>}
                                {invoice.customer_city && <p>{invoice.customer_city}</p>}
                                {invoice.customer_gstin && (
                                    <>
                                        <p>GSTIN/UIN &nbsp;:&nbsp; {invoice.customer_gstin}</p>
                                        <p>State Name &nbsp;: Tamil Nadu, Code : 33</p>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Right Column — Invoice Details Grid */}
                        <div className="w-1/2 text-[10.5px]">
                            <table className="w-full h-full border-collapse">
                                <tbody>
                                    {/* Row 1: Invoice No. | Dated — label+value stacked in same cell */}
                                    <tr className="border-b border-gray-400">
                                        <td className="px-1 pt-0.5 border-r border-gray-400 w-1/2 align-top">
                                            <div className="text-[9.5px] text-gray-600">Invoice No.</div>
                                            <div className="font-bold">{invoice.invoice_number}</div>
                                        </td>
                                        <td className="px-1 pt-0.5 w-1/2 align-top">
                                            <div className="text-[9.5px] text-gray-600">Dated</div>
                                            <div className="font-bold">{formatDate(invoice.invoice_date)}</div>
                                        </td>
                                    </tr>
                                    {/* Row 2: Delivery Note | Mode/Terms of Payment + As Agreed */}
                                    <tr className="border-b border-gray-400">
                                        <td className="px-1 pt-0.5 border-r border-gray-400 align-top">
                                            <div className="text-[9.5px] text-gray-600">Delivery Note</div>
                                        </td>
                                        <td className="px-1 pt-0.5 align-top">
                                            <div className="text-[9.5px] text-gray-600">Mode/Terms of Payment</div>
                                            <div className="font-semibold">As Agreed</div>
                                        </td>
                                    </tr>
                                    {/* Row 3: Reference No. & Date | Other References */}
                                    <tr className="border-b border-gray-400">
                                        <td className="px-1 pt-0.5 border-r border-gray-400 align-top">
                                            <div className="text-[9.5px] text-gray-600">Reference No. &amp; Date.</div>
                                        </td>
                                        <td className="px-1 pt-0.5 align-top">
                                            <div className="text-[9.5px] text-gray-600">Other References</div>
                                        </td>
                                    </tr>
                                    {/* Row 4: Buyer's Order No. | Dated */}
                                    <tr className="border-b border-gray-400">
                                        <td className="px-1 pt-0.5 border-r border-gray-400 align-top">
                                            <div className="text-[9.5px] text-gray-600">Buyer's Order No.</div>
                                            <div className="h-3"></div>
                                        </td>
                                        <td className="px-1 pt-0.5 align-top">
                                            <div className="text-[9.5px] text-gray-600">Dated</div>
                                            <div className="h-3"></div>
                                        </td>
                                    </tr>
                                    {/* Row 5: Dispatch Doc No. | Delivery Note Date */}
                                    <tr className="border-b border-gray-400">
                                        <td className="px-1 pt-0.5 border-r border-gray-400 align-top">
                                            <div className="text-[9.5px] text-gray-600">Dispatch Doc No.</div>
                                            <div className="h-3"></div>
                                        </td>
                                        <td className="px-1 pt-0.5 align-top">
                                            <div className="text-[9.5px] text-gray-600">Delivery Note Date</div>
                                            <div className="h-3"></div>
                                        </td>
                                    </tr>
                                    {/* Row 6: Dispatched through | Destination */}
                                    <tr className="border-b border-gray-400">
                                        <td className="px-1 pt-0.5 border-r border-gray-400 align-top">
                                            <div className="text-[9.5px] text-gray-600">Dispatched through</div>
                                            <div className="h-3"></div>
                                        </td>
                                        <td className="px-1 pt-0.5 align-top">
                                            <div className="text-[9.5px] text-gray-600">Destination</div>
                                            <div className="h-3"></div>
                                        </td>
                                    </tr>
                                    {/* Row 7: Terms of Delivery — full width */}
                                    <tr>
                                        <td colSpan={2} className="px-1 pt-0.5 pb-1">
                                            <div className="text-[9.5px] text-gray-600">Terms of Delivery</div>
                                            <div className="h-3"></div>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* ══ GOODS TABLE ══ */}
                    <table className="w-full border-collapse text-[10.5px]">
                        <thead>
                            <tr className="border-b border-gray-400">
                                <th className="border-r border-gray-400 p-1 w-8 text-center">Sl<br />No</th>
                                <th className="border-r border-gray-400 p-1 text-center">Description of Goods</th>
                                <th className="border-r border-gray-400 p-1 w-20 text-center">HSN/SAC</th>
                                <th className="border-r border-gray-400 p-1 w-20 text-center">Rate<br />(Incl. of Tax)</th>
                                <th className="p-1 w-28 text-center">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td className="border-r border-gray-400 p-1 text-center align-top">1</td>
                                <td className="border-r border-gray-400 p-1 align-top">
                                    <p className="font-bold">Electrical Energy Generated in Our Windmills</p>
                                    {descLines.map((line, i) => (
                                        <p key={i} className="leading-4">{line}</p>
                                    ))}
                                </td>
                                <td className="border-r border-gray-400 p-1 text-center align-top">
                                    <div>27160000</div>
                                </td>
                                <td className="border-r border-gray-400 p-1 text-center align-top"></td>
                                <td className="p-1 text-right align-top font-semibold">
                                    {formatAmount(absDisplayAmount)}
                                </td>
                            </tr>
                            {/* Spacer rows to fill the page */}
                            {Array.from({ length: 8 }).map((_, i) => (
                                <tr key={`spacer-${i}`} className="h-5">
                                    <td className="border-r border-gray-400"></td>
                                    <td className="border-r border-gray-400"></td>
                                    <td className="border-r border-gray-400"></td>
                                    <td className="border-r border-gray-400"></td>
                                    <td></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {/* ══ TOTAL ROW ══ */}
                    <div className="border-t border-gray-400 flex">
                        <div className="flex-1 border-r border-gray-400 p-1 text-right font-bold text-[10.5px]">Total</div>
                        <div className="w-28 p-1 text-right font-bold text-[10.5px]">
                            ₹ {formatAmount(absDisplayAmount)}
                        </div>
                    </div>

                    {/* ══ FOOTER ══ */}
                    <div className="border-t border-gray-400 text-[10.5px]">
                        {/* Amount in words */}
                        <div className="p-2 border-b border-gray-400">
                            <p className="font-semibold text-[10px] text-gray-600">Amount Chargeable (in words)</p>
                            <p className="font-bold mt-0.5">INR {displayAmountWords} Only</p>
                        </div>

                        {/* Tax Details Row */}
                        <div className="flex border-b border-gray-400 h-10">
                            <div className="flex-1 p-2 border-r border-gray-400 flex items-center">
                                <span className="font-semibold">Tax Amount (in words) :</span>
                                <span className="font-bold ml-2">NIL</span>
                            </div>
                            <div className="w-48 p-1 text-right flex flex-col justify-center">
                                <div className="flex justify-between px-1">
                                    <span className="text-gray-600">Taxable Value</span>
                                    <span className="font-semibold">{formatAmount(absDisplayAmount)}</span>
                                </div>
                                <div className="flex justify-between px-1 font-bold">
                                    <span>Total:</span>
                                    <span>{formatAmount(absDisplayAmount)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Remarks */}
                        <div className="p-2 border-b border-gray-400">
                            <p><span className="font-semibold">Remarks:</span> Tax Exempted</p>
                        </div>

                        {/* Signature block */}
                        <div className="p-3 flex justify-between">
                            <div className="w-1/2">
                                <p className="font-semibold underline">Declaration</p>
                                <p className="text-gray-600 text-[9.5px] mt-1 leading-4">
                                    We declare that this invoice shows the actual price of the<br />
                                    goods described and that all particulars are true and correct.
                                </p>
                            </div>
                            <div className="text-right w-1/2 flex flex-col justify-between">
                                <p className="font-semibold">for New Vision Wind Power Private Limited</p>
                                <div className="mt-12">
                                    <p className="font-semibold">Authorised Signatory</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Computer Generated Disclaimer */}
                    <div className="text-center py-2 border-t border-gray-300 text-[9px] text-gray-500 italic">
                        This is a Computer Generated Invoice
                    </div>

                </div>
                {/* end A4 container */}
            </div>
        </>
    );
}
