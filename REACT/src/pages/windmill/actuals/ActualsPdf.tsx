import React, { useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import api from "@/services/api";

export default function ActualsPdf() {
    const navigate = useNavigate();
    const { client_eb_id } = useParams();

    const [header, setHeader] = useState(null);
    const [data, setData] = useState([]);
    const [total, setTotal] = useState(0);
    const [grandTotal, setGrandTotal] = useState(0);

    useEffect(() => {
        fetchPdfData();
    }, []);

    const fetchPdfData = async () => {
        try {
            const res = await api.get(`/actuals/pdf/${client_eb_id}`);

            setHeader(res.data.header);
            setData(res.data.data);
            setTotal(res.data.total);
            setGrandTotal(res.data.grand_total);

        } catch (err) {
            console.error("Error fetching PDF data:", err);
        }
    };

    const getMonthName = (month) => {
        const months = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ];
        return months[month - 1] || "";
    };

    return (
        <div className="min-h-screen bg-gray-100 p-8">

            {/* Top Buttons */}
            <div className="mb-4 flex justify-between items-center no-print max-w-[210mm] mx-auto">
                <Button
                    variant="outline"
                    onClick={() => navigate(-1)}
                    className="flex items-center gap-2"
                >
                    <ArrowLeft className="h-4 w-4" /> Back
                </Button>
            </div>

            {/* PDF Container */}
            <div className="bg-white mx-auto p-8 shadow-lg max-w-[210mm] min-h-[297mm]">

                <h3 className="text-center font-bold mb-4">
                    Energy Allotment Order Charges
                </h3>

                {/* Header */}
                {header && (
    <div className="border p-4 mb-4 text-sm">
        <p><b>Customer:</b> {header.customer_name}</p>
        <p><b>Service No:</b> {header.sc_number}</p>
        <p><b>Year:</b> {header.year}</p>
        <p><b>Month:</b> {getMonthName(header.month)}</p>

       <p>
    <b>Self Generation Tax:</b>{" "}
    {(Number(header?.self_generation_tax) || 0).toFixed(3)}{" "}
   
</p>
    </div>
)}

                {/* Table */}
                <table className="w-full border-collapse border border-gray-300 text-sm">
                    <thead>
                        <tr className="bg-gray-100">
                            <th className="border p-2 text-left">Windmill</th>
                            <th className="border p-2 text-left">Wheeling Charges</th>
                        </tr>
                    </thead>

                    <tbody>
                        {data.map((item, index) => (
                            <tr key={index}>
                                <td className="border p-2">{item.windmill}</td>
                                <td className="border p-2">
    {(Number(item.wheeling_charges) || 0).toFixed(2)}
</td>
                            </tr>
                        ))}

                        {/* Total */}
                        <tr className="bg-gray-50 font-bold">
                            <td className="border p-2">Total</td>
                            <td className="border p-2">
    {(Number(total) || 0).toFixed(2)}
</td>
                        </tr>

                      
                    </tbody>
                </table>

            </div>
        </div>
    );
}