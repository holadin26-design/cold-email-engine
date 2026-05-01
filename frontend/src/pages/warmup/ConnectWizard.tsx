import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mail, Server, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';

export default function ConnectWizard() {
  const [method, setMethod] = useState<'gmail' | 'smtp' | null>(null);
  const [role, setRole] = useState<'primary' | 'seed'>('primary');
  const [loading, setLoading] = useState(false);
  
  // SMTP Form
  const [smtp, setSmtp] = useState({
    email: '',
    smtp_host: '', smtp_port: 587,
    imap_host: '', imap_port: 993,
    smtp_username: '', smtp_password: '',
    smtp_encryption: 'SSL/TLS'
  });

  const handleGmailAuth = async () => {
    try {
      setLoading(true);
      const { data } = await api.get(`/warmup/gmail-auth?role=${role}`);
      window.location.href = data.url;
    } catch (err: any) {
      toast.error('Failed to start Google OAuth');
      setLoading(false);
    }
  };

  const handleSmtpConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // 1. Test connection
      const tRes = await api.post('/warmup/test-smtp', smtp);
      const tData = tRes.data;
      if (!tData.smtp_ok || !tData.imap_ok) {
        toast.error(`Connection test failed: ${tData.error || 'Check your settings'}`);
        setLoading(false);
        return;
      }

      // 2. Save
      const sRes = await api.post('/warmup/save-smtp', { ...smtp, role });
      if (sRes.status === 200) {
        toast.success('SMTP/IMAP account connected successfully');
        window.location.href = role === 'seed' ? '/warmup/seed-pool' : '/warmup/accounts';
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save SMTP settings');
    } finally {
      setLoading(false);
    }
  };

  if (!method) {
    return (
      <div className="p-8 max-w-2xl mx-auto space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold font-outfit">Connect Account</h1>
          <p className="text-muted-foreground mt-2">Choose your connection method to start warming up</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="hover:border-teal-500 cursor-pointer transition-colors" onClick={() => setMethod('gmail')}>
             <CardHeader className="text-center">
                <div className="mx-auto w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center mb-2">
                   <Mail className="w-6 h-6 text-blue-600" />
                </div>
                <CardTitle>Google / Gmail</CardTitle>
                <CardDescription>Instant OAuth connection</CardDescription>
             </CardHeader>
          </Card>
          <Card className="hover:border-teal-500 cursor-pointer transition-colors" onClick={() => setMethod('smtp')}>
             <CardHeader className="text-center">
                <div className="mx-auto w-12 h-12 rounded-full bg-teal-100 flex items-center justify-center mb-2">
                   <Server className="w-6 h-6 text-teal-600" />
                </div>
                <CardTitle>SMTP / IMAP</CardTitle>
                <CardDescription>Custom server settings</CardDescription>
             </CardHeader>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-xl mx-auto space-y-8">
      <Button variant="ghost" onClick={() => setMethod(null)}>← Back</Button>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
             {method === 'gmail' ? <Mail className="w-5 h-5 text-blue-600" /> : <Server className="w-5 h-5 text-teal-600" />}
             Connect {method === 'gmail' ? 'Google' : 'Custom'} Account
          </CardTitle>
          <CardDescription>
             Configure this account as a primary sender or a seed account
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
             <Label>Account Role</Label>
             <Select value={role} onValueChange={(v: any) => setRole(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                   <SelectItem value="primary">Primary Sender (Warmup target)</SelectItem>
                   <SelectItem value="seed">Seed Account (Passive pool)</SelectItem>
                </SelectContent>
             </Select>
          </div>

          {method === 'gmail' ? (
            <div className="space-y-4 pt-4 border-t">
               <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <ShieldCheck className="w-5 h-5 text-blue-600 mt-1" />
                  <div className="text-sm">
                     <p className="font-bold">OAuth Security</p>
                     <p className="text-muted-foreground">WarmGrid never sees your password. All access is granted via secure tokens restricted to Gmail API scopes.</p>
                  </div>
               </div>
               <Button className="w-full flex items-center justify-center gap-2 py-6 text-lg" onClick={handleGmailAuth} disabled={loading}>
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Mail className="w-5 h-5" /> Sign in with Google</>}
               </Button>
            </div>
          ) : (
            <form onSubmit={handleSmtpConnect} className="space-y-4 pt-4 border-t">
               <div className="space-y-2">
                  <Label>Email Address</Label>
                  <Input type="email" placeholder="you@company.com" required value={smtp.email} onChange={e => setSmtp({...smtp, email: e.target.value})} />
               </div>
               
               <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                     <Label>SMTP Host</Label>
                     <Input placeholder="smtp.gmail.com" required value={smtp.smtp_host} onChange={e => setSmtp({...smtp, smtp_host: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                     <Label>SMTP Port</Label>
                     <Input type="number" placeholder="587" required value={smtp.smtp_port} onChange={e => setSmtp({...smtp, smtp_port: Number(e.target.value)})} />
                  </div>
               </div>

               <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                     <Label>IMAP Host</Label>
                     <Input placeholder="imap.gmail.com" required value={smtp.imap_host} onChange={e => setSmtp({...smtp, imap_host: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                     <Label>IMAP Port</Label>
                     <Input type="number" placeholder="993" required value={smtp.imap_port} onChange={e => setSmtp({...smtp, imap_port: Number(e.target.value)})} />
                  </div>
               </div>

               <div className="space-y-2">
                  <Label>Username / App Password</Label>
                  <Input type="password" placeholder="••••••••••••" required value={smtp.smtp_password} onChange={e => setSmtp({...smtp, smtp_password: e.target.value, smtp_username: smtp.email})} />
               </div>

               <Button type="submit" className="w-full py-6 text-lg" disabled={loading}>
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Connect Server'}
               </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
