import { useState, useEffect } from "react";
import { BarChart3, TrendingUp, Mail, MousePointerClick, Reply, AlertTriangle, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend } from "recharts";

const COLORS = ["hsl(221, 83%, 53%)", "hsl(142, 71%, 45%)", "hsl(38, 92%, 50%)", "hsl(0, 72%, 51%)", "hsl(220, 9%, 46%)"];

export default function AnalyticsPage() {
  const { user } = useAuth();
  const [followups, setFollowups] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [trackingEvents, setTrackingEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) loadData();
  }, [user]);

  const loadData = async () => {
    const [{ data: fups }, { data: camps }, { data: events }] = await Promise.all([
      supabase.from("followups").select("*").order("created_at", { ascending: true }),
      supabase.from("campaigns").select("*").order("created_at", { ascending: false }),
      supabase.from("tracking_events").select("*").order("created_at", { ascending: true }),
    ]);
    setFollowups(fups || []);
    setCampaigns(camps || []);
    setTrackingEvents(events || []);
    setLoading(false);
  };

  // Real tracking stats from tracking_events table
  const total = followups.length;
  const sent = followups.filter(f => f.status === "sent" || f.status === "replied").length;
  const opens = trackingEvents.filter(e => e.event_type === "open").length;
  const clicks = trackingEvents.filter(e => e.event_type === "click").length;
  const replied = followups.filter(f => f.status === "replied").length;
  const bounced = followups.filter(f => f.status === "failed").length;
  const unsubscribes = trackingEvents.filter(e => e.event_type === "unsubscribe").length;

  const openRate = sent > 0 ? ((opens / sent) * 100).toFixed(1) : "0";
  const clickRate = sent > 0 ? ((clicks / sent) * 100).toFixed(1) : "0";
  const replyRate = sent > 0 ? ((replied / sent) * 100).toFixed(1) : "0";
  const bounceRate = total > 0 ? ((bounced / total) * 100).toFixed(1) : "0";

  // Status distribution
  const statusCounts = followups.reduce((acc, f) => {
    acc[f.status] = (acc[f.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const pieData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));

  // Daily send volume
  const dailyData = followups.reduce((acc, f) => {
    const date = new Date(f.scheduled_for).toLocaleDateString();
    if (!acc[date]) acc[date] = { date, sent: 0, replied: 0, opens: 0 };
    if (f.status === "sent" || f.status === "replied") acc[date].sent++;
    if (f.status === "replied") acc[date].replied++;
    return acc;
  }, {} as Record<string, any>);

  // Add opens per day from tracking events
  for (const event of trackingEvents) {
    if (event.event_type === "open") {
      const date = new Date(event.created_at).toLocaleDateString();
      if (dailyData[date]) dailyData[date].opens++;
    }
  }

  const lineData = Object.values(dailyData).slice(-30);

  // Campaign performance
  const campaignData = campaigns.map(c => {
    const cFollowups = followups.filter(f => f.email_account_id === c.email_account_id);
    return {
      name: c.name.length > 15 ? c.name.slice(0, 15) + "…" : c.name,
      sent: cFollowups.filter(f => f.status === "sent" || f.status === "replied").length,
      replied: cFollowups.filter(f => f.status === "replied").length,
      pending: cFollowups.filter(f => f.status === "pending").length,
    };
  });

  const statCards = [
    { label: "Total Sent", value: sent, icon: Mail, color: "text-primary", sub: `${total} total` },
    { label: "Open Rate", value: `${openRate}%`, icon: TrendingUp, color: "text-success", sub: `${opens} opens` },
    { label: "Click Rate", value: `${clickRate}%`, icon: MousePointerClick, color: "text-warning", sub: `${clicks} clicks` },
    { label: "Reply Rate", value: `${replyRate}%`, icon: Reply, color: "text-primary", sub: `${replied} replies` },
    { label: "Bounce Rate", value: `${bounceRate}%`, icon: AlertTriangle, color: "text-destructive", sub: `${bounced} bounced` },
  ];

  const exportCSV = () => {
    const headers = "Email,Subject,Status,Scheduled,Sent At,Opens,Clicks\n";
    const followupOpens = (fid: string) => trackingEvents.filter(e => e.followup_id === fid && e.event_type === "open").length;
    const followupClicks = (fid: string) => trackingEvents.filter(e => e.followup_id === fid && e.event_type === "click").length;
    const rows = followups.map(f =>
      `"${f.recipient_email}","${f.subject}","${f.status}","${f.scheduled_for}","${f.sent_at || ''}","${followupOpens(f.id)}","${followupClicks(f.id)}"`
    ).join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "analytics-export.csv";
    a.click();
  };

  return (
    <div className="space-y-6">
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
              <p className="text-xl font-semibold">{loading ? "—" : stat.value}</p>
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
              <LineChart data={lineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 91%)" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="sent" stroke="hsl(221, 83%, 53%)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="replied" stroke="hsl(142, 71%, 45%)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="opens" stroke="hsl(38, 92%, 50%)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-sm font-medium">Status Distribution</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {pieData.length === 0 ? (
              <div className="flex items-center justify-center h-[240px] text-sm text-muted-foreground">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {campaignData.length > 0 && (
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-sm font-medium">Campaign Performance</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={campaignData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 91%)" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="sent" fill="hsl(221, 83%, 53%)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="replied" fill="hsl(142, 71%, 45%)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="pending" fill="hsl(38, 92%, 50%)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
