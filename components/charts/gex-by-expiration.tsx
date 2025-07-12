"use client"

import { Bar } from "react-chartjs-2"
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from "chart.js"

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

interface GexByExpirationProps {
  ticker: string
}

export function GexByExpiration({ ticker }: GexByExpirationProps) {
  // In a real implementation, this would fetch the actual data
  // This is sample data based on the image in the README
  const expirations = [
    "2023-05-19",
    "2023-05-26",
    "2023-06-02",
    "2023-06-16",
    "2023-06-30",
    "2023-07-21",
    "2023-08-18",
    "2023-09-15",
    "2023-12-15",
    "2024-01-19",
    "2024-03-15",
    "2024-06-21",
  ]

  const gexValues = [-12.5, -8.2, -5.1, -3.8, -2.5, -1.8, -1.2, -0.8, -0.5, -0.3, -0.2, -0.1]

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      title: {
        display: true,
        text: `${ticker} GEX by Expiration`,
        color: "#FFF",
        font: {
          size: 16,
          weight: "bold" as const,
        },
      },
    },
    scales: {
      x: {
        grid: {
          color: "#2A3459",
        },
        ticks: {
          color: "#FFF",
          maxRotation: 45,
          minRotation: 45,
        },
        title: {
          display: true,
          text: "Expiration Date",
          color: "#FFF",
          font: {
            weight: "bold" as const,
          },
        },
      },
      y: {
        grid: {
          color: "#2A3459",
        },
        ticks: {
          color: "#FFF",
        },
        title: {
          display: true,
          text: "Gamma Exposure (Bn$ / %)",
          color: "#FFF",
          font: {
            weight: "bold" as const,
          },
        },
      },
    },
  }

  const data = {
    labels: expirations,
    datasets: [
      {
        data: gexValues,
        backgroundColor: "rgba(254, 83, 187, 0.5)",
        borderColor: "rgba(254, 83, 187, 1)",
        borderWidth: 1,
      },
    ],
  }

  return <Bar options={options} data={data} />
}
