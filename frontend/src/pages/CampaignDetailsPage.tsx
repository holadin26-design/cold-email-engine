import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Clock, CheckCircle2, XCircle, MoreVertical, Play, Pause } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import api from "@/lib/api";

interface Lead {
  id: string;
  email: string;
  name: string;
  status: string;
  sent_at: string;
  replied_at: string;
  followup_step_1_sent_at?: string;
  followup_step_2_sent_at?: string;
  followup_step_3_sent_at?: string;
}

export default function CampaignDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<any>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [id]);

  const loadData = async () => {
    try {
      setLoading(true);
      // Get all campaigns to find this one (since there is no GET /campaigns/:id yet, we filter the list)
      const { data: camps } = await api.get("/campaigns");
      const found = camps.find((c: any) => c.id === id);
      setCampaign(found);

      // Get leads for this campaign
      const { data: leadData } = await api.get(`/campaign-leads/${id}`);
      setLeads(leadData || []);
    } catch (err) {
      toast.error("Failed to load campaign details");
    } finally {
      setLoading(false);
    }
  };

  const toggleStatus = async () => {
    const newStatus = campaign.status === 'running' ? 'paused' : 'running';
    try {
      await api.patch(`/campaigns/${id}/status`, { status: newStatus });
      toast.success(`Campaign ${newStatus}`);
      loadData();
    } catch (err: any) {
      toast.error("Error updating status");
    }
  };

  const formatDate = (iso: string) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  if (loading) return <div className="p-12 text-center text-muted-foreground animate-pulse">Loading campaign details...</div>;
  if (!campaign) return <div className="p-12 text-center">Campaign not found.</div>;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/campaigns")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Contacted {campaign.sent} of {campaign.total_leads} leads</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={toggleStatus}>
            {campaign.status === 'running' ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
            {campaign.status === 'running' ? 'Pause' : 'Resume'}
          </Button>
          <Badge variant={campaign.status === 'running' ? 'success' : 'outline'} className="uppercase tracking-widest text-[10px] px-2">
            {campaign.status}
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-sm font-medium">Subject Line</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm border p-3 rounded-md bg-muted/30 italic">"{campaign.subject}"</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-sm font-medium">Timing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Min Delay:</span>
              <span>{campaign.delay_min}s</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Max Delay:</span>
              <span>{campaign.delay_max}s</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-sm font-medium">Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-bold">{Math.round((campaign.sent / campaign.total_leads) * 100)}%</span>
              <span className="text-sm text-muted-foreground pb-1">Complete</span>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5 mt-2">
              <div 
                className="bg-primary h-1.5 rounded-full transition-all" 
                style={{ width: `${(campaign.sent / campaign.total_leads) * 100}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="py-4 border-b">
          <CardTitle className="text-sm font-medium">Leads Contacted</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 text-muted-foreground">
                  <th className="text-left py-3 px-4 font-medium uppercase tracking-wider text-[10px]">Lead email</th>
                  <th className="text-left py-3 px-4 font-medium uppercase tracking-wider text-[10px]">Status</th>
                  <th className="text-left py-3 px-4 font-medium uppercase tracking-wider text-[10px]">Last Contacted</th>
                  <th className="text-left py-3 px-4 font-medium uppercase tracking-wider text-[10px]">Replies</th>
                  <th className="text-right py-3 px-4 font-medium uppercase tracking-wider text-[10px]"><MoreVertical className="h-4 w-4 ml-auto" /></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {leads.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-muted-foreground">No leads found for this campaign.</td>
                  </tr>
                ) : (
                  leads.map((lead) => (
                    <tr key={lead.id} className="hover:bg-muted/20 transition-colors group">
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">{lead.email}</span>
                          <span className="text-[10px] text-muted-foreground">{lead.name || "No name"}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        {lead.status === 'sent' ? (
                          <div className="flex items-center gap-1.5 text-green-600">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span className="text-xs font-medium">Sent</span>
                          </div>
                        ) : lead.status === 'pending' ? (
                          <div className="flex items-center gap-1.5 text-blue-500">
                            <Clock className="h-3.5 w-3.5" />
                            <span className="text-xs font-medium">Pending</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-destructive">
                            <XCircle className="h-3.5 w-3.5" />
                            <span className="text-xs font-medium">Failed</span>
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-muted-foreground">
                        {formatDate(lead.sent_at)}
                      </td>
                      <td className="py-3.5 px-4">
                        {lead.replied_at ? (
                          <Badge variant="success" className="bg-green-100 text-green-700 hover:bg-green-100 border-green-200 py-0 text-[10px]">
                            Interested
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <a 
                          href={`mailto:${lead.email}`} 
                          className="text-primary opacity-0 group-hover:opacity-100 transition-opacity text-xs font-medium hover:underline"
                        >
                          Send Direct
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
