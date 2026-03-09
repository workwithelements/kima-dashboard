"use client"

import { AreaChart, Area } from "recharts"

type SparklineProps = {
  data: number[]
  color?: string
  width?: number
  height?: number
}

export default function Sparkline({
  data,
  color = "#CDFF00",
  width = 80,
  height = 32,
}: SparklineProps) {
  const chartData = data.map((v, i) => ({ i, v }))

  return (
    <AreaChart width={width} height={height} data={chartData}>
      <Area
        type="monotone"
        dataKey="v"
        stroke={color}
        fill={color}
        fillOpacity={0.1}
        strokeWidth={1.5}
        dot={false}
        isAnimationActive={false}
      />
    </AreaChart>
  )
}
