import { useEffect, useState } from "react";
import {
  Send, Clock, CheckCircle, TrendingUp, AlertCircle, ArrowUpRight, Mail, Loader2, PlayCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  sent: "secondary",
  replied: "default",
  cancelled: "destructive",
  failed: "destructive",
};

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [followups, setFollowups] = useState<any[]>([]);
  const [stats, setStats] = useState({ total: 0, pending: 0, replied: 0, sent: 0 });
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (user) loadData();
  }, [user]);

  const loadData = async () => {
    try {
      const { data: fups } = await supabase
        .from("followups")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);
      setFollowups(fups || []);

      const { count: total } = await supabase.from("followups").select("*", { count: "exact", head: true });
      const { count: pending } = await supabase.from("followups").select("*", { count: "exact", head: true }).eq("status", "pending");
      const { count: replied } = await supabase.from("followups").select("*", { count: "exact", head: true }).eq("status", "replied");
      const { count: sent } = await supabase.from("followups").select("*", { count: "exact", head: true }).eq("status", "sent");

      setStats({ total: total || 0, pending: pending || 0, replied: replied || 0, sent: sent || 0 });
    } catch (error) {
      console.error("Error loading dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  const processQueue = async () => {
    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-email");
      if (error) throw error;
      toast.success(`Processed: ${data?.processed || 0} sent, ${data?.failed || 0} failed`);
      loadData();
    } catch (err: any) {
      toast.error(err.message || "Failed to process queue");
    } finally {
      setProcessing(false);
    }
  };

  const missedFollowups = followups.filter(
    (f) => f.status === "pending" && new Date(f.scheduled_for) < new Date()
  );

  const statCards = [
    { label: "Total Emails", value: stats.total, icon: Send, color: "text-primary" },
    { label: "Pending", value: stats.pending, icon: Clock, color: "text-warning" },
    { label: "Replied", value: stats.replied, icon: CheckCircle, color: "text-success" },
    { label: "Sent", value: stats.sent, icon: TrendingUp, color: "text-primary" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Overview of your email outreach performance.</p>
        </div>
        <Button size="sm" onClick={processQueue} disabled={processing}>
          {processing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="mr-1.5 h-3.5 w-3.5" />}
          Process Queue
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
              </div>
              <p className="text-2xl font-semibold">{loading ? "—" : stat.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Overdue alert */}
      {missedFollowups.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4">
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-destructive">{missedFollowups.length} overdue follow-ups</p>
            <div className="mt-1.5 space-y-0.5">
              {missedFollowups.slice(0, 3).map((m) => (
                <p key={m.id} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{m.recipient_email}</span> — {m.subject}
                </p>
              ))}
            </div>
            <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={processQueue} disabled={processing}>
              {processing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <PlayCircle className="mr-1 h-3 w-3" />}
              Send Now
            </Button>
          </div>
        </div>
      )}

      {/* Recent */}
      <Card>
        <CardHeader className="flex-row items-center justify-between py-4">
          <CardTitle className="text-base font-medium">Recent Emails</CardTitle>
          <Button variant="ghost" size="sm" className="text-xs text-primary h-8" onClick={() => navigate("/followups")}>
            View All <ArrowUpRight className="ml-1 h-3 w-3" />
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {loading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
            ) : followups.length === 0 ? (
              <div className="py-12 text-center">
                <Mail className="h-6 w-6 mx-auto mb-2 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No follow-ups yet</p>
              </div>
            ) : (
              followups.map((fup) => (
                <div key={fup.id} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50 transition-colors">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    {fup.recipient_email[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{fup.recipient_email}</p>
                      <Badge variant={statusVariant[fup.status] || "outline"} className="text-[10px] px-1.5 py-0">
                        {fup.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{fup.subject}</p>
                  </div>
                  <div className="hidden sm:block text-right">
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(fup.scheduled_for).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
