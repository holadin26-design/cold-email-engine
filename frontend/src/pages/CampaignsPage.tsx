import { useState, useEffect } from "react";
import { Plus, Play, Pause, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import api from "@/lib/api";
import { useNavigate } from "react-router-dom";

export default function CampaignsPage() {
    const navigate = useNavigate();
    const [campaigns, setCampaigns] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadCampaigns();
    }, []);

    const loadCampaigns = async () => {
        try {
            const { data } = await api.get(`/campaigns`);
            setCampaigns(data || []);
        } catch (err) {
            console.error("Failed to load campaigns:", err);
            toast.error("Failed to load campaigns from server");
        } finally {
            setLoading(false);
        }
    };

    const toggleCampaignStatus = async (id: string, currentStatus: string) => {
        const newStatus = currentStatus === 'running' ? 'paused' : 'running';
        try {
            await api.patch(`/campaigns/${id}/status`, { status: newStatus });
            toast.success(`Campaign ${newStatus}`);
            loadCampaigns();
        } catch (err: any) {
            toast.error(err.response?.data?.error || "Error updating campaign");
        }
    };

    const deleteCampaign = async (id: string) => {
        if (!confirm("Are you sure? This will delete all pending emails for this campaign.")) return;
        try {
            await api.delete(`/campaigns/${id}`);
            toast.success("Campaign deleted");
            loadCampaigns();
        } catch (err: any) {
            toast.error("Error deleting campaign");
        }
    };

    return (
        <div className="space-y-6 max-w-4xl">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
                    <p className="text-sm text-muted-foreground mt-1">Manage and track your active cold email campaigns.</p>
                </div>
                <Button onClick={() => navigate("/campaigns/new")}>
                    <Plus className="mr-2 h-4 w-4" /> New Campaign
                </Button>
            </div>

            <Card>
                <CardHeader className="py-4">
                    <CardTitle className="text-sm font-medium">All Campaigns</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="divide-y border-t">
                        {loading ? (
                            <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
                        ) : campaigns.length === 0 ? (
                            <div className="p-12 text-center text-sm text-muted-foreground">
                                No campaigns yet. Click 'New Campaign' to start.
                            </div>
                        ) : (
                            campaigns.map((camp) => (
                                <div key={camp.id} className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors">
                                    <div className="space-y-1 cursor-pointer" onClick={() => navigate(`/campaigns/${camp.id}`)}>
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-medium text-sm group-hover:text-primary transition-colors">{camp.name}</h3>
                                            <Badge variant={camp.status === 'running' ? 'success' : 'outline'} className="text-[10px] px-1.5 py-0 uppercase tracking-widest">
                                                {camp.status}
                                            </Badge>
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            Delay: {camp.delay_min}-{camp.delay_max}s • {camp.sent}/{camp.total_leads} Sent
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button variant="outline" size="sm" onClick={() => toggleCampaignStatus(camp.id, camp.status)}>
                                            {camp.status === 'running' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                                        </Button>
                                        <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => deleteCampaign(camp.id)}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
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
