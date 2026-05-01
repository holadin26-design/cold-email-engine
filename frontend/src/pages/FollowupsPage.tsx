import { useState, useEffect } from "react";
import {
    MessageSquareReply,
    Mail,
    Clock,
    Inbox,
    RefreshCw,
    Save,
    CheckCircle2,
    ToggleLeft,
    ToggleRight,
    Eye,
    AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import api from "@/lib/api";

interface Reply {
    id: string;
    email: string;
    name: string;
    replied_at: string;
    reply_body?: string;
    campaign_name: string;
    campaign_id: string;
}

interface Campaign {
    id: string;
    name: string;
}

interface FollowupStep {
    step: number;
    delayDays: number;
    subject: string;
    body: string;
    enabled: boolean;
}

interface FollowupsConfig {
    enabled: boolean;
    steps: FollowupStep[];
}

const DEFAULT_STEPS = [
    { step: 1, delayDays: 2, label: "Follow-up 1", color: "bg-blue-500", textColor: "text-blue-600 dark:text-blue-400" },
    { step: 2, delayDays: 4, label: "Follow-up 2", color: "bg-violet-500", textColor: "text-violet-600 dark:text-violet-400" },
    { step: 3, delayDays: 6, label: "Follow-up 3", color: "bg-orange-500", textColor: "text-orange-600 dark:text-orange-400" },
];

export default function FollowupsPage() {
    const [replies, setReplies] = useState<Reply[]>([]);
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");

    const [configEnabled, setConfigEnabled] = useState(true);
    const [editingSteps, setEditingSteps] = useState<Record<number, FollowupStep>>({});
    
    const [campaignVariables, setCampaignVariables] = useState<string[]>([]);

    const [loadingReplies, setLoadingReplies] = useState(true);
    const [loadingTemplates, setLoadingTemplates] = useState(false);
    const [savingStep, setSavingStep] = useState<number | null>(null);
    const [savingGlobal, setSavingGlobal] = useState(false);
    const [savedSteps, setSavedSteps] = useState<Record<number, boolean>>({});

    useEffect(() => {
        loadReplies();
        loadCampaigns();
    }, []);

    useEffect(() => {
        if (selectedCampaignId) {
            loadTemplates(selectedCampaignId);
            loadVariables(selectedCampaignId);
        } else {
            setEditingSteps({});
            setCampaignVariables([]);
        }
    }, [selectedCampaignId]);

    const loadReplies = async () => {
        setLoadingReplies(true);
        try {
            const { data } = await api.get("/replies");
            setReplies(data || []);
        } catch {
            toast.error("Failed to load replies");
        } finally {
            setLoadingReplies(false);
        }
    };

    const loadCampaigns = async () => {
        try {
            const { data } = await api.get("/campaigns");
            setCampaigns(data || []);
            if (data && data.length > 0) {
                setSelectedCampaignId(data[0].id);
            }
        } catch {
            toast.error("Failed to load campaigns");
        }
    };

    const loadVariables = async (campaignId: string) => {
        try {
            const { data } = await api.get(`/campaigns/${campaignId}/variables`);
            setCampaignVariables(data || []);
        } catch {
            // fail silently, just no extra vars
            setCampaignVariables([]);
        }
    };

    const loadTemplates = async (campaignId: string) => {
        setLoadingTemplates(true);
        try {
            const { data } = await api.get(`/campaigns/${campaignId}/followups`);
            const conf: FollowupsConfig = data;
            
            setConfigEnabled(conf.enabled ?? true);
            
            const editing: Record<number, FollowupStep> = {};
            (conf.steps || []).forEach(step => {
                editing[step.step] = step;
            });
            setEditingSteps(editing);
        } catch {
            toast.error("Failed to load campaign follow-up config");
        } finally {
            setLoadingTemplates(false);
        }
    };

    const handleManualSync = async () => {
        setLoadingReplies(true);
        try {
            toast.info("Checking inboxes for new replies...");
            await api.post("/replies/sync");
            await loadReplies();
            toast.success("Inbox sync complete");
        } catch {
            toast.error("Failed to sync replies");
            setLoadingReplies(false);
        }
    };

    const buildFullConfig = (currentStepEdits: Record<number, FollowupStep>, globalEnabled: boolean): FollowupsConfig => {
        return {
            enabled: globalEnabled,
            steps: DEFAULT_STEPS.map(ds => {
                // If we have local edits for this step, use those, else defaults
                const local = currentStepEdits[ds.step];
                if (local) return local;
                return {
                    step: ds.step,
                    delayDays: ds.delayDays,
                    subject: "Re: {{original_subject}}",
                    body: "",
                    enabled: true
                };
            })
        };
    };

    const handleSaveGlobalToggle = async (newEnabled: boolean) => {
        if (!selectedCampaignId) return;
        setSavingGlobal(true);
        setConfigEnabled(newEnabled);

        const configToSave = buildFullConfig(editingSteps, newEnabled);

        try {
            await api.put(`/campaigns/${selectedCampaignId}/followups`, configToSave);
            toast.success(`Follow-ups ${newEnabled ? "enabled" : "disabled"} for campaign`);
        } catch {
            toast.error("Failed to save campaign follow-up status");
            setConfigEnabled(!newEnabled); // revert
        } finally {
            setSavingGlobal(false);
        }
    };

    const handleSaveStep = async (stepNumber: number) => {
        if (!selectedCampaignId) return;
        
        const editing = editingSteps[stepNumber];
        if (!editing) return;
        
        setSavingStep(stepNumber);
        
        const configToSave = buildFullConfig(editingSteps, configEnabled);

        try {
            await api.put(`/campaigns/${selectedCampaignId}/followups`, configToSave);
            
            setSavedSteps((prev) => ({ ...prev, [stepNumber]: true }));
            setTimeout(() => setSavedSteps((prev) => ({ ...prev, [stepNumber]: false })), 2000);
            toast.success(`Follow-up ${stepNumber} saved`);
        } catch {
            toast.error(`Failed to save follow-up ${stepNumber}`);
        } finally {
            setSavingStep(null);
        }
    };

    const handleToggleEnabled = async (stepNumber: number) => {
        if (!selectedCampaignId) return;

        const current = editingSteps[stepNumber];
        if (!current) return;

        const newEnabled = !current.enabled;
        
        const updatedSteps = {
            ...editingSteps,
            [stepNumber]: { ...current, enabled: newEnabled }
        };
        
        setEditingSteps(updatedSteps);

        const configToSave = buildFullConfig(updatedSteps, configEnabled);
        
        try {
            await api.put(`/campaigns/${selectedCampaignId}/followups`, configToSave);
            toast.success(`Follow-up ${stepNumber} ${newEnabled ? "enabled" : "disabled"}`);
        } catch {
            toast.error("Failed to update status");
            // Revert
            setEditingSteps(editingSteps);
        }
    };

    const formatDate = (iso: string) => {
        const d = new Date(iso);
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    };

    const activeCampaign = campaigns.find(c => c.id.toString() === selectedCampaignId);
    const allDisabled = DEFAULT_STEPS.every((s) => editingSteps[s.step]?.enabled === false) || !configEnabled;

    return (
        <div className="space-y-6 max-w-6xl">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Campaign Follow-Ups</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Configure automated follow-up sequences individually for each campaign.
                    </p>
                </div>
                
                {campaigns.length > 0 && (
                    <div className="w-full md:w-72">
                        <label className="text-xs font-medium text-muted-foreground mb-1 block">Select Campaign</label>
                        <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
                            <SelectTrigger className="w-full bg-background">
                                <SelectValue placeholder="Select a campaign..." />
                            </SelectTrigger>
                            <SelectContent>
                                {campaigns.map(c => (
                                    <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}
            </div>

            {!selectedCampaignId ? (
                <div className="p-12 text-center rounded-xl border border-dashed text-muted-foreground">
                    <p>Select a campaign above to configure its follow-up sequence.</p>
                </div>
            ) : (
                <div className="space-y-6">
                    <Card className="bg-primary/5 border-primary/20">
                        <CardContent className="py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                            <div>
                                <h3 className="font-semibold text-primary">Automated Follow-ups</h3>
                                <p className="text-xs text-muted-foreground mt-1">
                                    When enabled, {activeCampaign?.name} will automatically send follow-ups to leads who haven't replied.
                                </p>
                            </div>
                            <Button 
                                variant={configEnabled ? "default" : "outline"} 
                                className={`w-full sm:w-auto ${configEnabled ? 'bg-primary hover:bg-primary/90' : ''}`}
                                onClick={() => handleSaveGlobalToggle(!configEnabled)}
                                disabled={savingGlobal}
                            >
                                {savingGlobal ? "Saving..." : configEnabled ? "Enabled for this Campaign" : "Disabled"}
                            </Button>
                        </CardContent>
                    </Card>

                    {allDisabled && configEnabled && (
                        <div className="flex items-start gap-3 rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30 p-3">
                            <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                            <p className="text-sm text-yellow-700 dark:text-yellow-400">
                                Global follow-ups are enabled, but all individual steps are currently disabled. No emails will be sent.
                            </p>
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                        {/* ── TEMPLATE EDITOR ── */}
                        <div className="space-y-4">
                            <div className="text-sm font-medium text-muted-foreground">Follow-up Sequence Steps</div>

                            {!configEnabled ? (
                                <div className="p-12 text-center border rounded-xl bg-muted/40 text-muted-foreground text-sm">
                                    Follow-ups are disabled for this campaign.
                                </div>
                            ) : loadingTemplates ? (
                                <div className="p-12 text-center text-sm text-muted-foreground">Loading sequence config…</div>
                            ) : (
                                DEFAULT_STEPS.map((s) => {
                                    const editing = editingSteps[s.step] || {
                                        step: s.step,
                                        delayDays: s.delayDays,
                                        subject: "",
                                        body: "",
                                        enabled: false
                                    };
                                    
                                    const isSaved = savedSteps[s.step];
                                    const isSaving = savingStep === s.step;
                                    const isEnabled = editing.enabled;

                                    return (
                                        <Card key={s.step} className={`transition-opacity ${!isEnabled ? "opacity-60 bg-muted/30" : ""}`}>
                                            <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0">
                                                <div className="flex items-center gap-2.5">
                                                    <div className={`h-7 w-7 rounded-full ${s.color} text-white flex items-center justify-center text-xs font-bold flex-shrink-0`}>
                                                        {s.step}
                                                    </div>
                                                    <div>
                                                        <CardTitle className="text-sm font-medium">Step {s.step}</CardTitle>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => handleToggleEnabled(s.step)}
                                                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                                    title={isEnabled ? "Disable this step" : "Enable this step"}
                                                >
                                                    {isEnabled ? (
                                                        <ToggleRight className={`h-5 w-5 ${s.textColor}`} />
                                                    ) : (
                                                        <ToggleLeft className="h-5 w-5 text-muted-foreground/50" />
                                                    )}
                                                    <span className="text-[11px]">{isEnabled ? "On" : "Off"}</span>
                                                </button>
                                            </CardHeader>
                                            <CardContent className="px-4 pb-4 space-y-4">
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="text-xs text-muted-foreground mb-1 block font-medium">
                                                            Wait Duration (Days)
                                                        </label>
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                className="w-20 h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                                                value={editing.delayDays || 1}
                                                                onChange={(e) =>
                                                                    setEditingSteps((prev) => ({
                                                                        ...prev,
                                                                        [s.step]: { ...editing, delayDays: parseInt(e.target.value) || 1 },
                                                                    }))
                                                                }
                                                                disabled={!isEnabled}
                                                            />
                                                            <span className="text-xs text-muted-foreground/80">days after prev step</span>
                                                        </div>
                                                    </div>
                                                    
                                                    <div>
                                                        <label className="text-xs text-muted-foreground mb-1 block font-medium">
                                                            Subject <span className="text-muted-foreground/60 font-normal truncate max-w-[100px] inline-block align-bottom relative top-0.5">{"{{original_subject}}"}</span>
                                                        </label>
                                                        <input
                                                            type="text"
                                                            className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                                            value={editing.subject || ""}
                                                            onChange={(e) =>
                                                                setEditingSteps((prev) => ({
                                                                    ...prev,
                                                                    [s.step]: { ...editing, subject: e.target.value },
                                                                }))
                                                            }
                                                            placeholder="Re: {{original_subject}}"
                                                            disabled={!isEnabled}
                                                        />
                                                    </div>
                                                </div>
                                                
                                                <div>
                                                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 mb-1">
                                                        <label className="text-xs text-muted-foreground font-medium">
                                                            Message body
                                                        </label>
                                                        <div className="flex flex-wrap gap-1.5 justify-end">
                                                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono text-muted-foreground bg-muted/50 cursor-copy hover:bg-muted" onClick={() => navigator.clipboard.writeText('{{name}}')} title="Click to copy">{"{{name}}"}</Badge>
                                                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono text-muted-foreground bg-muted/50 cursor-copy hover:bg-muted" onClick={() => navigator.clipboard.writeText('{{email}}')} title="Click to copy">{"{{email}}"}</Badge>
                                                            {campaignVariables.map(v => (
                                                                <Badge key={v} variant="secondary" className="text-[10px] px-1.5 py-0 font-mono text-primary/70 bg-primary/5 border-primary/20 cursor-copy hover:bg-primary/10 transition-colors" onClick={() => navigator.clipboard.writeText(`{{${v}}}`)} title="Click to copy">
                                                                    {"{{" + v + "}}"}
                                                                </Badge>
                                                            ))}
                                                        </div>
                                                    </div>
                                                    <textarea
                                                        className="w-full rounded-md border border-input bg-background text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring resize-none font-mono tracking-tight"
                                                        rows={4}
                                                        value={editing.body || ""}
                                                        onChange={(e) =>
                                                            setEditingSteps((prev) => ({
                                                                ...prev,
                                                                [s.step]: { ...editing, body: e.target.value },
                                                            }))
                                                        }
                                                        placeholder="Write your follow-up message here..."
                                                        disabled={!isEnabled}
                                                    />
                                                </div>
                                                <Button
                                                    size="sm"
                                                    className="w-full"
                                                    onClick={() => handleSaveStep(s.step)}
                                                    disabled={isSaving || !isEnabled}
                                                >
                                                    {isSaved ? (
                                                        <>
                                                            <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />
                                                            Saved!
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Save className="mr-2 h-4 w-4" />
                                                            {isSaving ? "Saving…" : "Save Template"}
                                                        </>
                                                    )}
                                                </Button>
                                            </CardContent>
                                        </Card>
                                    );
                                })
                            )}
                        </div>

                        {/* ── REPLY INBOX ── */}
                        <div className="space-y-4">
                            <div className="text-sm font-medium text-muted-foreground">Reply Inbox</div>
                            <Card className="flex flex-col h-[calc(100vh-250px)] min-h-[500px] border">
                                <CardHeader className="py-4 flex flex-row items-center justify-between space-y-0 border-b flex-none">
                                    <div className="flex items-center gap-2">
                                        <Inbox className="h-4 w-4 text-primary" />
                                        <CardTitle className="text-sm font-medium">Recent Replies</CardTitle>
                                        {replies.length > 0 && (
                                            <Badge className="text-[10px] px-1.5 py-0 ml-1">{replies.length}</Badge>
                                        )}
                                    </div>
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleManualSync} disabled={loadingReplies} title="Force Sync Now">
                                        <RefreshCw className={`h-3.5 w-3.5 ${loadingReplies ? "animate-spin" : ""}`} />
                                    </Button>
                                </CardHeader>
                                <CardContent className="p-0 flex flex-col flex-1 overflow-hidden">
                                    <div className="divide-y overflow-y-auto flex-1 custom-scrollbar">
                                        {loadingReplies ? (
                                            <div className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center justify-center h-full">
                                                <RefreshCw className="h-6 w-6 animate-spin mb-4 text-muted-foreground/30" />
                                                Loading...
                                            </div>
                                        ) : replies.length === 0 ? (
                                            <div className="p-12 flex flex-col items-center justify-center space-y-3 h-full mix-blend-luminosity opacity-70">
                                                <MessageSquareReply className="h-10 w-10 text-muted-foreground/40" />
                                                <p className="text-sm font-medium text-muted-foreground">Inbox is quiet</p>
                                                <p className="text-xs text-muted-foreground/70 max-w-[200px] text-center">
                                                    Replies from your leads will appear here automatically.
                                                </p>
                                            </div>
                                        ) : (
                                            replies.map((r) => (
                                                <div key={r.id} className="flex items-start gap-4 p-5 hover:bg-muted/40 transition-colors">
                                                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5 border border-primary/20">
                                                        <Mail className="h-3.5 w-3.5 text-primary" />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-semibold text-sm truncate">{r.name || r.email.split('@')[0]}</span>
                                                                <Badge variant="outline" className="text-[9px] uppercase tracking-wider px-1.5 py-0 text-success border-success/30 bg-success/10 bg-green-500/10 text-green-600 border-green-500/20">
                                                                    Replied
                                                                </Badge>
                                                            </div>
                                                            <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                                                                <Clock className="h-3 w-3" />
                                                                {formatDate(r.replied_at)}
                                                            </span>
                                                        </div>
                                                        <p className="text-[13px] text-muted-foreground mb-3">{r.email}</p>
                                                        
                                                        {r.reply_body && (
                                                            <div className="mt-2 text-[13px] leading-relaxed text-foreground/90 p-4 rounded-lg bg-muted/40 border border-border/50 whitespace-pre-wrap font-sans">
                                                                {r.reply_body}
                                                            </div>
                                                        )}
                                                        
                                                        <div className="mt-4 pt-3 border-t border-border/30 flex items-center gap-2">
                                                            <Badge variant="secondary" className="text-[10px] font-normal bg-secondary/50 text-secondary-foreground">
                                                                Campaign: {r.campaign_name}
                                                            </Badge>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Open tracking info */}
                            <Card className="bg-blue-50/50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900/40">
                                <CardContent className="p-4 flex gap-3">
                                    <Eye className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
                                    <div className="space-y-1">
                                        <p className="text-xs font-semibold text-blue-900 dark:text-blue-200">Open Tracking Active</p>
                                        <p className="text-xs text-blue-700/80 dark:text-blue-300/70 leading-relaxed">
                                            A 1×1 pixel is attached to all outbound emails. Open rates are calculated automatically and show in Analytics. Threading is preserved using `Message-ID` headers.
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
