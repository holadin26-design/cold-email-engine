import { useState, useEffect } from "react";
import { Mail, Plus, Trash2, CheckCircle, Activity, Pencil, Clock, Flame } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import api from "@/lib/api";

export default function AccountsPage() {
    const [emailAccounts, setEmailAccounts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [validating, setValidating] = useState(false);
    const [newAccount, setNewAccount] = useState({
        email: "", display_name: "", app_password: "",
        smtp_host: "smtp.gmail.com", smtp_port: 587,
        imap_host: "imap.gmail.com", imap_port: 993,
        daily_send_limit: 20
    });

    useEffect(() => {
        loadAccounts();
    }, []);

    const loadAccounts = async () => {
        try {
            const { data } = await api.get(`/accounts`);
            setEmailAccounts(data || []);
        } catch (err) {
            console.error("Failed to load accounts:", err);
            toast.error("Failed to load accounts");
        } finally {
            setLoading(false);
        }
    };

    const getResetTime = (reachedAtStr: string) => {
        const reachedAt = new Date(reachedAtStr).getTime();
        const resetAt = reachedAt + (24 * 60 * 60 * 1000);
        const remaining = resetAt - Date.now();
        
        if (remaining <= 0) return "Resetting...";
        
        const hours = Math.floor(remaining / (3600 * 1000));
        const mins = Math.floor((remaining % (3600 * 1000)) / (60 * 1000));
        return `Resets in ${hours}h ${mins}m`;
    };

    const addAccount = async () => {
        try {
            await api.post(`/accounts`, newAccount);
            toast.success("Account added");
            setShowAddDialog(false);
            setNewAccount({
                email: "", display_name: "", app_password: "",
                smtp_host: "smtp.gmail.com", smtp_port: 587,
                imap_host: "imap.gmail.com", imap_port: 993,
                daily_send_limit: 20
            });
            loadAccounts();
        } catch (err: any) {
            toast.error(err.response?.data?.error || "Error adding account");
        }
    };

    const deleteAccount = async (id: string) => {
        try {
            await api.delete(`/accounts/${id}`);
            toast.success("Removed");
            loadAccounts();
        } catch (err: any) {
            toast.error(err.response?.data?.error || "Error deleting account");
        }
    };

    const validateAccount = async (accountId: string) => {
        setValidating(true);
        try {
            const { data } = await api.post(`/accounts/${accountId}/verify`);
            if (data.success) toast.success("Connection validated");
            else toast.error("Validation failed");
        } catch (error: any) {
            toast.error(error.response?.data?.error || "Error validating account");
        } finally {
            setValidating(false);
        }
    };

    const setPrimary = async (id: string) => {
        try {
            await api.patch(`/accounts/${id}/primary`);
            toast.success("Primary updated");
            loadAccounts();
        } catch (err) {
            toast.error("Failed to update primary account");
        }
    };

    const resetSendsToday = async (id: string) => {
        try {
            await api.patch(`/accounts/${id}/reset`);
            toast.success("Counter reset");
            loadAccounts();
        } catch (err) {
            toast.error("Failed to reset counter");
        }
    };

    const toggleWarmup = async (id: string, enabled: boolean) => {
        try {
            await api.post(`/warmup/update-settings`, { account_id: id, warmup_enabled: enabled, warmup_status: enabled ? 'active' : 'inactive' });
            toast.success(enabled ? "Warmup enabled" : "Warmup disabled");
            loadAccounts();
        } catch (err: any) {
            toast.error(err.response?.data?.error || "Error toggling warmup");
        }
    };

    const toggleCampaign = async (id: string, enabled: boolean) => {
        try {
            await api.patch(`/accounts/${id}/campaign-sending`, { enabled });
            toast.success(enabled ? "Campaign sending enabled" : "Campaign sending disabled");
            loadAccounts();
        } catch (err: any) {
            toast.error(err.response?.data?.error || "Error toggling campaign sending");
        }
    };

    const [editingLimit, setEditingLimit] = useState<{ id: string, limit: number } | null>(null);

    const updateLimit = async () => {
        if (!editingLimit) return;
        try {
            await api.patch(`/accounts/${editingLimit.id}/limit`, { limit: editingLimit.limit });
            toast.success("Limit updated");
            setEditingLimit(null);
            loadAccounts();
        } catch (err: any) {
            toast.error(err.response?.data?.error || "Error updating limit");
        }
    };

    return (
        <div className="space-y-6 max-w-2xl">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">Accounts & Limits</h1>
                <p className="text-sm text-muted-foreground mt-1">Manage your SMTP credentials and daily limits.</p>
            </div>

            <Card>
                <CardHeader className="flex-row items-center justify-between py-4">
                    <div>
                        <CardTitle className="text-sm font-medium">Email Accounts</CardTitle>
                        <CardDescription className="text-xs">SMTP/IMAP credentials for sending emails</CardDescription>
                    </div>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowAddDialog(true)}>
                        <Plus className="mr-1 h-3 w-3" /> Add
                    </Button>
                </CardHeader>
                <CardContent className="space-y-2 pt-0">
                    {loading ? (
                        <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
                    ) : emailAccounts.length === 0 ? (
                        <div className="text-center py-8">
                            <Mail className="h-5 w-5 mx-auto mb-2 text-muted-foreground/40" />
                            <p className="text-xs text-muted-foreground">No email accounts yet</p>
                            <p className="text-[11px] text-muted-foreground mt-1">Add a Gmail account with App Password to start.</p>
                        </div>
                    ) : (
                        emailAccounts.map((acc) => (
                            <div key={acc.id} className="rounded-lg border p-3 space-y-2">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                                        {acc.email[0].toUpperCase()}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <p className="text-sm font-medium truncate">{acc.email}</p>
                                            {acc.is_primary && <Badge variant="default" className="text-[10px] px-1.5 py-0">Primary</Badge>}
                                        </div>
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                            <p className="text-[11px] text-muted-foreground">
                                                {acc.smtp_host}:{acc.smtp_port} · Limit: {acc.daily_send_limit}/day
                                            </p>
                                            <Button 
                                                variant="ghost" 
                                                size="icon" 
                                                className="h-4 w-4 text-muted-foreground hover:text-primary"
                                                onClick={() => setEditingLimit({ id: acc.id, limit: acc.daily_send_limit })}
                                            >
                                                <Pencil className="h-2.5 w-2.5" />
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 pr-2 border-l pl-3 ml-2">
                                        <div className="flex flex-col items-center gap-1">
                                            <Label className="text-[10px] uppercase text-muted-foreground">Campaigns</Label>
                                            <div className="flex items-center gap-2">
                                                <Mail className={`h-3.5 w-3.5 ${acc.allow_campaign_sending !== false ? 'text-blue-500' : 'text-muted-foreground/30'}`} />
                                                <Switch 
                                                    checked={acc.allow_campaign_sending !== false} 
                                                    onCheckedChange={(checked) => toggleCampaign(acc.id, checked)}
                                                />
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-center gap-1 border-l pl-3">
                                            <Label className="text-[10px] uppercase text-muted-foreground">Warmup</Label>
                                            <div className="flex items-center gap-2">
                                                <Flame className={`h-3.5 w-3.5 ${acc.warmup_enabled ? 'text-orange-500 fill-orange-500/20' : 'text-muted-foreground/30'}`} />
                                                <Switch 
                                                    checked={acc.warmup_enabled || false} 
                                                    onCheckedChange={(checked) => toggleWarmup(acc.id, checked)}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => validateAccount(acc.id)} disabled={validating}>
                                            <CheckCircle className="mr-1 h-3 w-3" /> Test
                                        </Button>
                                        {!acc.is_primary && (
                                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setPrimary(acc.id)}>Primary</Button>
                                        )}
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteAccount(acc.id)}>
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                                {/* Send limit progress */}
                                <div className="flex items-center gap-3 pl-11">
                                    <Activity className="h-3 w-3 text-muted-foreground shrink-0" />
                                    <div className="flex-1">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                                                {acc.sends_today || 0} / {acc.daily_send_limit || 20} sent today
                                                {acc.limit_reached_at && (
                                                    <span className="text-orange-500 font-medium flex items-center gap-0.5 ml-1">
                                                        <Clock className="h-2.5 w-2.5" />
                                                        {getResetTime(acc.limit_reached_at)}
                                                    </span>
                                                )}
                                            </span>
                                            <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={() => resetSendsToday(acc.id)}>
                                                Reset
                                            </Button>
                                        </div>
                                        <Progress value={acc.daily_send_limit > 0 ? ((acc.sends_today || 0) / acc.daily_send_limit) * 100 : 0} className="h-1.5" />
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                    <p className="text-[11px] text-muted-foreground pt-2">
                        <span className="font-medium">Gmail:</span> Use App Passwords (Google Account → Security → App Passwords).
                    </p>
                </CardContent>
            </Card>

            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                {/* ... existing dialog content ... */}
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader><DialogTitle>Add Email Account</DialogTitle></DialogHeader>
                    <div className="space-y-4 max-h-[70vh] overflow-y-auto px-1">
                        <div className="space-y-1.5"><Label className="text-xs">Email *</Label><Input placeholder="your@gmail.com" value={newAccount.email} onChange={(e) => setNewAccount({ ...newAccount, email: e.target.value })} /></div>
                        <div className="space-y-1.5"><Label className="text-xs">Display Name</Label><Input placeholder="Your Name" value={newAccount.display_name} onChange={(e) => setNewAccount({ ...newAccount, display_name: e.target.value })} /></div>
                        <div className="space-y-1.5"><Label className="text-xs">App Password *</Label><Input type="password" placeholder="Google App Password" value={newAccount.app_password} onChange={(e) => setNewAccount({ ...newAccount, app_password: e.target.value })} /></div>

                        <Separator />
                        <div className="space-y-1.5">
                            <Label className="text-xs">Daily Sending Limit *</Label>
                            <Input type="number" placeholder="20" value={newAccount.daily_send_limit} onChange={(e) => setNewAccount({ ...newAccount, daily_send_limit: parseInt(e.target.value) || 20 })} />
                            <p className="text-[10px] text-muted-foreground">Emails sent per day before pausing this account.</p>
                        </div>

                        <Separator />
                        <p className="text-xs font-medium">SMTP (Outgoing)</p>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5"><Label className="text-xs">Host</Label><Input value={newAccount.smtp_host} onChange={(e) => setNewAccount({ ...newAccount, smtp_host: e.target.value })} /></div>
                            <div className="space-y-1.5"><Label className="text-xs">Port</Label><Input type="number" value={newAccount.smtp_port} onChange={(e) => setNewAccount({ ...newAccount, smtp_port: parseInt(e.target.value) || 587 })} /></div>
                        </div>
                        <p className="text-xs font-medium">IMAP (Incoming)</p>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5"><Label className="text-xs">Host</Label><Input value={newAccount.imap_host} onChange={(e) => setNewAccount({ ...newAccount, imap_host: e.target.value })} /></div>
                            <div className="space-y-1.5"><Label className="text-xs">Port</Label><Input type="number" value={newAccount.imap_port} onChange={(e) => setNewAccount({ ...newAccount, imap_port: parseInt(e.target.value) || 993 })} /></div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" size="sm" onClick={() => setShowAddDialog(false)}>Cancel</Button>
                        <Button size="sm" onClick={addAccount} disabled={!newAccount.email || !newAccount.app_password}>Add Account</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!editingLimit} onOpenChange={(open) => !open && setEditingLimit(null)}>
                <DialogContent className="sm:max-w-xs">
                    <DialogHeader><DialogTitle>Update Daily Limit</DialogTitle></DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Emails per day</Label>
                            <Input 
                                type="number" 
                                value={editingLimit?.limit || 0} 
                                onChange={(e) => setEditingLimit(prev => prev ? { ...prev, limit: parseInt(e.target.value) || 0 } : null)} 
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" size="sm" onClick={() => setEditingLimit(null)}>Cancel</Button>
                        <Button size="sm" onClick={updateLimit}>Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
