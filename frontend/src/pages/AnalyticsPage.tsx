import { useState, useEffect } from "react";
import { TrendingUp, Mail, MousePointerClick, Reply, AlertTriangle, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend } from "recharts";
import api from "@/lib/api";
import { toast } from "sonner";

const COLORS = ["hsl(221, 83%, 53%)", "hsl(142, 71%, 45%)", "hsl(38, 92%, 50%)", "hsl(0, 72%, 51%)", "hsl(220, 9%, 46%)"];

export default function AnalyticsPage() {
    const [analytics, setAnalytics] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const { data } = await api.get(`/analytics`);
            setAnalytics(data);
        } catch (err) {
            console.error("Failed to load analytics: ", err);
            toast.error("Failed to load analytics data");
        } finally {
            setLoading(false);
        }
    };

    const exportCSV = () => {
        // Since we are using an interceptor for user-id, a simple window.open won't work easily for auth.
        // For now, let's keep the logic but the user would need to use api client for the file if possible.
        // Or we use a temporary signed URL from Supabase storage if it was there.
        // For simplicity, let's just use the api client to get the data and then trigger download in JS.
        toast.info("Preparing export...");
        api.get('/analytics/export', { responseType: 'blob' }).then(res => {
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'analytics.csv');
            document.body.appendChild(link);
            link.click();
        }).catch(() => {
            toast.error("Export failed");
        });
    };

    if (loading || !analytics) return <div className="p-8 text-center text-muted-foreground animate-pulse">Loading analytics...</div>;

    const statCards = [
        { label: "Total Sent", value: analytics.sent, icon: Mail, color: "text-primary", sub: `${analytics.total} total` },
        { label: "Open Rate", value: `${analytics.openRate}%`, icon: TrendingUp, color: "text-success", sub: `${analytics.opens} opens` },
        { label: "Click Rate", value: `${analytics.clickRate}%`, icon: MousePointerClick, color: "text-warning", sub: `${analytics.clicks} clicks` },
        { label: "Reply Rate", value: `${analytics.replyRate}%`, icon: Reply, color: "text-primary", sub: `${analytics.replied} replies` },
        { label: "Bounce Rate", value: `${analytics.bounceRate}%`, icon: AlertTriangle, color: "text-destructive", sub: `${analytics.bounced} bounced` },
    ];

    return (
        <div className="space-y-6 max-w-6xl">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
                    <p className="text-sm text-muted-foreground mt-1">Campaign performance and email metrics.</p>
                </div>
                <Button size="sm" variant="outline" onClick={exportCSV}>
                    <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
                </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {statCards.map((stat) => (
                    <Card key={stat.label}>
                        <CardContent className="p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <stat.icon className={`h-4 w-4 ${stat.color}`} />
                                <span className="text-xs text-muted-foreground">{stat.label}</span>
                            </div>
                            <p className="text-xl font-semibold">{stat.value}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">{stat.sub}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                    <CardHeader className="py-4">
                        <CardTitle className="text-sm font-medium">Send Volume (Last 30 Days)</CardTitle>
                    </CardHeader>
                    <CardContent className="pb-4">
                        <ResponsiveContainer width="100%" height={240}>
                            <LineChart data={analytics.dailyData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, backgroundColor: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
                                <Legend wrapperStyle={{ fontSize: 11 }} />
                                <Line type="monotone" dataKey="sent" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                                <Line type="monotone" dataKey="replied" stroke="hsl(var(--success))" strokeWidth={2} dot={false} />
                                <Line type="monotone" dataKey="opens" stroke="hsl(var(--warning))" strokeWidth={2} dot={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="py-4">
                        <CardTitle className="text-sm font-medium">Status Distribution</CardTitle>
                    </CardHeader>
                    <CardContent className="pb-4">
                        {analytics.pieData?.length === 0 ? (
                            <div className="flex items-center justify-center h-[240px] text-sm text-muted-foreground">No data</div>
                        ) : (
                            <ResponsiveContainer width="100%" height={240}>
                                <PieChart>
                                    <Pie data={analytics.pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value" labelLine={false}>
                                        {analytics.pieData.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                                    </Pie>
                                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, backgroundColor: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
                                </PieChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>
            </div>

            {analytics.campaignData?.length > 0 && (
                <Card>
                    <CardHeader className="py-4">
                        <CardTitle className="text-sm font-medium">Campaign Performance</CardTitle>
                    </CardHeader>
                    <CardContent className="pb-4">
                        <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={analytics.campaignData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, backgroundColor: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
                                <Legend wrapperStyle={{ fontSize: 11 }} />
                                <Bar dataKey="sent" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                                <Bar dataKey="replied" fill="hsl(var(--success))" radius={[3, 3, 0, 0]} />
                                <Bar dataKey="pending" fill="hsl(var(--warning))" radius={[3, 3, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
