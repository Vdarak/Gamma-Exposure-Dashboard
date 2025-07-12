import React, { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { OptionData } from "@/lib/types";

interface GEXDataGraphDashboardProps {
  data: OptionData[];
}

export const GEXDataGraphDashboard: React.FC<GEXDataGraphDashboardProps> = ({ data }) => {
  // Aggregate by expiration date (YYYY-MM-DD)
  const chartData = useMemo(() => {
    const grouped: Record<string, { totalGamma: number; netGamma: number }> = {};
    data.forEach((o) => {
      const dateKey = new Date(o.expiration).toISOString().split("T")[0];
      if (!grouped[dateKey]) grouped[dateKey] = { totalGamma: 0, netGamma: 0 };
      const openInterest = o.open_interest || 0;
      const gammaValue = typeof o.gamma === "number" ? o.gamma * openInterest * 100 : 0;
      grouped[dateKey].totalGamma += gammaValue;
      grouped[dateKey].netGamma += o.type === "C" ? gammaValue : -gammaValue;
    });
    return Object.entries(grouped)
      .map(([date, { totalGamma, netGamma }]) => ({ date, totalGamma, netGamma }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [data]);

  return (
    <ResponsiveContainer width="100%" height={400}>
      <LineChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" />
        <YAxis />
        <Tooltip formatter={(value: any) => new Intl.NumberFormat("en").format(value as number)} />
        <Legend />
        <Line type="linear" dataKey="totalGamma" stroke="#8b5cf6" name="Total Gamma" dot={false} strokeWidth={2} />
        <Line type="linear" dataKey="netGamma" stroke="#22c55e" name="Net Gamma" dot={false} strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
};
