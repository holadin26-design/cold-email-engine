import { useState, useEffect } from "react";
import { Mail, Plus, Trash2, CheckCircle, Shield, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function SettingsPage() {
  const { user } = useAuth();
  const [emailAccounts, setEmailAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [validating, setValidating] = useState(false);
  const [newAccount, setNewAccount] = useState({
    email: "", display_name: "", app_password: "",
    smtp_host: "smtp.gmail.com", smtp_port: 587,
    imap_host: "imap.gmail.com", imap_port: 993,
  });

  useEffect(() => {
    if (user) loadAccounts();
  }, [user]);

  const loadAccounts = async () => {
    const { data } = await supabase.from("email_accounts").select("*").order("created_at", { ascending: false });
    setEmailAccounts(data || []);
    setLoading(false);
  };

  const addAccount = async () => {
    if (!user) return;
    const { error } = await supabase.from("email_accounts").insert({
      user_id: user.id, email: newAccount.email, display_name: newAccount.display_name || null,
      app_password: newAccount.app_password, smtp_host: newAccount.smtp_host, smtp_port: newAccount.smtp_port,
      imap_host: newAccount.imap_host, imap_port: newAccount.imap_port, is_primary: emailAccounts.length === 0,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Account added");
    setShowAddDialog(false);
    setNewAccount({ email: "", display_name: "", app_password: "", smtp_host: "smtp.gmail.com", smtp_port: 587, imap_host: "imap.gmail.com", imap_port: 993 });
    loadAccounts();
  };

  const deleteAccount = async (id: string) => {
    await supabase.from("email_accounts").delete().eq("id", id);
    toast.success("Removed");
    loadAccounts();
  };

  const validateAccount = async (accountId: string) => {
    setValidating(true);
    try {
      const { data, error } = await supabase.functions.invoke("validate-email", { body: { email_account_id: accountId } });
      if (error) throw error;
      if (data?.success) toast.success("Connection validated");
      else toast.error(data?.error || "Validation failed");
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setValidating(false);
    }
  };

  const setPrimary = async (id: string) => {
    await supabase.from("email_accounts").update({ is_primary: false }).eq("user_id", user!.id);
    await supabase.from("email_accounts").update({ is_primary: true }).eq("id", id);
    toast.success("Primary updated");
    loadAccounts();
  };

  const resetSendsToday = async (id: string) => {
    await supabase.from("email_accounts").update({ sends_today: 0 }).eq("id", id);
    toast.success("Counter reset");
    loadAccounts();
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account and email connections.</p>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success/10">
              <Shield className="h-4 w-4 text-success" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">{user?.email}</p>
              <p className="text-xs text-muted-foreground">Signed in via Google</p>
            </div>
            <Badge variant="outline" className="text-[10px] border-success/30 text-success">Connected</Badge>
          </div>
        </CardContent>
      </Card>

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
                    <p className="text-[11px] text-muted-foreground">
                      {acc.smtp_host}:{acc.smtp_port} · {acc.imap_host}:{acc.imap_port}
                    </p>
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
                      <span className="text-[11px] text-muted-foreground">
                        {acc.sends_today} / {acc.daily_send_limit} sent today
                      </span>
                      <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={() => resetSendsToday(acc.id)}>
                        Reset
                      </Button>
                    </div>
                    <Progress value={acc.daily_send_limit > 0 ? (acc.sends_today / acc.daily_send_limit) * 100 : 0} className="h-1.5" />
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Add Email Account</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label className="text-xs">Email *</Label><Input placeholder="your@gmail.com" value={newAccount.email} onChange={(e) => setNewAccount({ ...newAccount, email: e.target.value })} /></div>
            <div className="space-y-1.5"><Label className="text-xs">Display Name</Label><Input placeholder="Your Name" value={newAccount.display_name} onChange={(e) => setNewAccount({ ...newAccount, display_name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label className="text-xs">App Password *</Label><Input type="password" placeholder="Google App Password" value={newAccount.app_password} onChange={(e) => setNewAccount({ ...newAccount, app_password: e.target.value })} /></div>
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
    </div>
  );
}
