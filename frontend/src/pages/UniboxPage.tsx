import { useState, useEffect, useRef } from "react";
import { Inbox, Mail, Clock, RefreshCw, ChevronRight, CheckCircle2, FilterX, AtSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
    Select, 
    SelectContent, 
    SelectItem, 
    SelectTrigger, 
    SelectValue 
} from "@/components/ui/select";
import { toast } from "sonner";
import api from "@/lib/api";

interface Reply {
    id: string;
    email: string;
    name: string;
    replied_at: string;
    reply_body?: string;
    reply_sentiment?: string;
    campaign_name: string;
    campaign_id: string;
    received_by_account?: string;
}

interface Campaign {
    id: string;
    name: string;
}

export default function UniboxPage() {
    const [replies, setReplies] = useState<Reply[]>([]);
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [loading, setLoading] = useState(true);
    
    // Filters
    const [selectedCampaignId, setSelectedCampaignId] = useState<string>("all");
    const [selectedSentiment, setSelectedSentiment] = useState<string>("all");
    const [lastSynced, setLastSynced] = useState<Date | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        loadCampaigns();
    }, []);

    // Poll for new replies every 5 minutes
    useEffect(() => {
        loadReplies();
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(() => {
            loadReplies(true); // silent refresh (no spinner)
        }, 5 * 60 * 1000);
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [selectedCampaignId, selectedSentiment]);

    const loadCampaigns = async () => {
        try {
            const { data } = await api.get("/campaigns");
            setCampaigns(data || []);
        } catch {
            console.error("Failed to load campaigns for filter");
        }
    };

    const loadReplies = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const params: any = {};
            if (selectedCampaignId !== "all") params.campaignId = selectedCampaignId;
            if (selectedSentiment !== "all") params.sentiment = selectedSentiment;

            const { data } = await api.get("/replies", { params });
            // Sort by id DESC — newest detected reply first (id = DB insertion order)
            const sorted = (data || []).sort(
                (a: any, b: any) => Number(b.id) - Number(a.id)
            );
            setReplies(sorted);
            setLastSynced(new Date());
        } catch {
            if (!silent) toast.error("Failed to load Unibox data");
        } finally {
            if (!silent) setLoading(false);
        }
    };

    const handleManualSync = async () => {
        setLoading(true);
        try {
            toast.info("Checking inboxes for new replies...");
            await api.post("/replies/sync");
            await loadReplies();
            toast.success("Inbox sync complete");
        } catch {
            toast.error("Failed to sync replies");
        } finally {
            setLoading(false);
        }
    };

    const clearFilters = () => {
        setSelectedCampaignId("all");
        setSelectedSentiment("all");
    };

    const formatDate = (iso: string) => {
        const d = new Date(iso);
        return d.toLocaleDateString("en-US", { 
            month: "short", 
            day: "numeric", 
            hour: "2-digit", 
            minute: "2-digit" 
        });
    };

    const hasFilters = selectedCampaignId !== "all" || selectedSentiment !== "all";

    return (
        <div className="space-y-6 max-w-6xl">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Unibox</h1>
                    <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        Centralized inbox for all campaign responses.
                        {lastSynced && (
                            <span className="ml-2 text-xs text-muted-foreground/60">
                                Last synced: {lastSynced.toLocaleTimeString()}
                            </span>
                        )}
                    </p>
                </div>
                
                <div className="flex items-center gap-3">
                    <div className="w-[200px]">
                        <label className="text-[10px] uppercase font-bold text-muted-foreground mb-1 block">Filter by Campaign</label>
                        <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
                            <SelectTrigger className="h-9">
                                <SelectValue placeholder="All Campaigns" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Campaigns</SelectItem>
                                {campaigns.map(c => (
                                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="w-[160px]">
                        <label className="text-[10px] uppercase font-bold text-muted-foreground mb-1 block">Sentiment</label>
                        <Select value={selectedSentiment} onValueChange={setSelectedSentiment}>
                            <SelectTrigger className="h-9">
                                <SelectValue placeholder="All Replies" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Styles</SelectItem>
                                <SelectItem value="positive">Interested</SelectItem>
                                <SelectItem value="negative">Not Interested</SelectItem>
                                <SelectItem value="neutral">Neutral/Other</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {hasFilters && (
                        <Button variant="ghost" size="sm" className="h-9 mt-5 text-muted-foreground" onClick={clearFilters}>
                            <FilterX className="h-4 w-4 mr-2" />
                            Clear
                        </Button>
                    )}
                </div>
            </div>

            <Card className="border-t-4 border-t-primary shadow-sm">
                <CardHeader className="py-4 flex flex-row items-center justify-between space-y-0 bg-muted/20">
                    <div className="flex items-center gap-2">
                        <Inbox className="h-5 w-5 text-primary" />
                        <CardTitle className="text-base font-medium">
                            {selectedSentiment === "positive" ? "Interested Replies" : 
                             selectedSentiment === "negative" ? "Negative Replies" : 
                             "All Campaign Replies"}
                        </CardTitle>
                        {replies.length > 0 && (
                            <Badge variant="default" className="ml-2 font-bold px-2 py-0.5 rounded-full">
                                {replies.length}
                            </Badge>
                        )}
                    </div>
                    <Button variant="outline" size="sm" className="h-8 gap-2" onClick={handleManualSync} disabled={loading}>
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                        Sync Now
                    </Button>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="divide-y border-t">
                        {loading ? (
                            <div className="p-12 text-center text-sm text-muted-foreground animate-pulse">
                                Loading replies...
                            </div>
                        ) : replies.length === 0 ? (
                            <div className="p-16 text-center space-y-3">
                                <div className="mx-auto h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center">
                                    <Inbox className="h-6 w-6 text-muted-foreground/60" />
                                </div>
                                <div>
                                    <p className="text-base font-medium">No replies found.</p>
                                    <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                                        {hasFilters 
                                            ? "Try adjusting your filters to see more results."
                                            : "When leads respond to your campaigns, they will appear here (excluding auto-replies)."}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            replies.map((r) => (
                                <div key={r.id} className="flex items-start gap-4 p-5 hover:bg-muted/30 transition-colors group">
                                    <div className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 border ${
                                        r.reply_sentiment === 'positive' ? 'bg-green-100 border-green-200' :
                                        r.reply_sentiment === 'negative' ? 'bg-red-100 border-red-200' :
                                        'bg-primary/10 border-primary/20'
                                    }`}>
                                        <Mail className={`h-5 w-5 ${
                                            r.reply_sentiment === 'positive' ? 'text-green-600' :
                                            r.reply_sentiment === 'negative' ? 'text-red-600' :
                                            'text-primary'
                                        }`} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-4 mb-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-semibold text-base">{r.name || r.email.split('@')[0]}</span>
                                                {r.reply_sentiment === 'positive' && (
                                                    <Badge variant="outline" className="text-[10px] uppercase tracking-wider px-2 py-0 border-green-200 bg-green-50 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400 font-bold">
                                                        Interested
                                                    </Badge>
                                                )}
                                                {r.reply_sentiment === 'negative' && (
                                                    <Badge variant="outline" className="text-[10px] uppercase tracking-wider px-2 py-0 border-red-200 bg-red-50 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400 font-bold">
                                                        Not Interested
                                                    </Badge>
                                                )}
                                            </div>
                                            <span className="text-xs text-muted-foreground/80 flex items-center gap-1.5 whitespace-nowrap">
                                                <Clock className="h-3.5 w-3.5" />
                                                {formatDate(r.replied_at)}
                                            </span>
                                        </div>
                                        
                                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                                            <a href={`mailto:${r.email}`} className="text-sm text-muted-foreground hover:text-primary transition-colors hover:underline">
                                                {r.email}
                                            </a>
                                            <span className="text-muted-foreground/30">•</span>
                                            <span className="text-xs text-muted-foreground/70 flex items-center gap-1 bg-muted/50 px-2 py-0.5 rounded-sm">
                                                <ChevronRight className="h-3 w-3" />
                                                Campaign: {r.campaign_name}
                                            </span>
                                            {r.received_by_account && (
                                                <span className="text-xs text-blue-600/70 dark:text-blue-400/70 flex items-center gap-1 bg-blue-50/50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 px-2 py-0.5 rounded-sm">
                                                    <AtSign className="h-3 w-3" />
                                                    {r.received_by_account}
                                                </span>
                                            )}
                                        </div>
                                        
                                        {r.reply_body && (
                                            <div className={`mt-2 text-sm p-4 rounded-lg border shadow-sm whitespace-pre-wrap leading-relaxed ${
                                                r.reply_sentiment === 'positive' ? 'bg-green-50/30 border-green-100 text-green-900 dark:text-green-100' :
                                                r.reply_sentiment === 'negative' ? 'bg-red-50/30 border-red-100 text-red-900 dark:text-red-100' :
                                                'bg-card border shadow-sm text-foreground/90'
                                            }`}>
                                                {r.reply_body}
                                            </div>
                                        )}
                                        
                                        <div className="mt-4 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                                            <Button size="sm" variant="secondary" className="text-xs h-8" onClick={() => window.open(`mailto:${r.email}?subject=Re: Following up`)}>
                                                Reply via Email Client
                                            </Button>
                                            {r.reply_sentiment === 'positive' && (
                                                <Button size="sm" variant="outline" className="text-xs h-8 border-green-200 text-green-700 hover:bg-green-50">
                                                    Mark as Customer
                                                </Button>
                                            )}
                                        </div>
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
