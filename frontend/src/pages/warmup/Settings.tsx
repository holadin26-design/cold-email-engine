import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Save, Settings as SettingsIcon, ShieldCheck, Calendar, RefreshCw, Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from "@/components/ui/switch";
import api from '@/lib/api';
import { WarmupNav } from './WarmupDashboard';

export default function Settings() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = async () => {
    try {
      const { data } = await api.get('/warmup/stats');
      setAccounts(data.accounts || []);
      if (data.accounts?.length > 0 && !selectedId) {
        setSelectedId(data.accounts[0].id);
        setSettings(data.accounts[0]);
      }
    } catch (err: any) {
      toast.error("Failed to load settings data");
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAccountChange = (id: string) => {
    const acc = accounts.find(a => a.id === id);
    setSelectedId(id);
    setSettings(acc);
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await api.post('/warmup/update-settings', { account_id: selectedId, ...settings });
      toast.success('Settings updated successfully');
      fetchData();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Update failed');
    } finally {
      setLoading(false);
    }
  };

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  if (!settings) return <div className="p-8">No accounts found to configure.</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <WarmupNav />
      <div>
        <h1 className="text-3xl font-bold font-outfit">Warmup Settings</h1>
        <p className="text-muted-foreground">Customize your warmup strategy and dispatch windows</p>
      </div>

      <div className="flex items-center gap-4 bg-slate-100 dark:bg-slate-800 p-4 rounded-lg">
         <Label className="font-bold">Select Account:</Label>
         <Select value={selectedId} onValueChange={handleAccountChange}>
            <SelectTrigger className="w-[300px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
               {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.email}</SelectItem>)}
            </SelectContent>
         </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
         <div className="space-y-6">
            <Card>
               <CardHeader>
                  <CardTitle className="flex items-center gap-2"><SettingsIcon className="w-5 h-5" /> Volume & Limits</CardTitle>
               </CardHeader>
               <CardContent className="space-y-4">
                  <div className="space-y-2">
                     <Label>Maximum Daily Limit</Label>
                     <Input type="number" value={settings.warmup_daily_limit} onChange={e => setSettings({...settings, warmup_daily_limit: Number(e.target.value)})} />
                     <p className="text-xs text-muted-foreground">The absolute ceiling for daily warmup emails.</p>
                  </div>
                  <div className="space-y-2">
                     <Label>Ramp-Up Target (Days)</Label>
                     <Input type="number" value={settings.warmup_ramp_target} onChange={e => setSettings({...settings, warmup_ramp_target: Number(e.target.value)})} />
                  </div>
               </CardContent>
            </Card>

            <Card>
               <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Calendar className="w-5 h-5" /> Sending Window</CardTitle>
               </CardHeader>
               <CardContent className="space-y-4">
                  <div className="flex items-center justify-between pb-2 border-b dark:border-slate-800">
                    <div className="space-y-0.5">
                      <Label className="text-base">24/7 Mode</Label>
                      <p className="text-xs text-muted-foreground">Ignore time limits and run all day</p>
                    </div>
                    <Switch 
                      checked={settings.warmup_send_window_start === settings.warmup_send_window_end} 
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSettings({
                            ...settings,
                            warmup_send_window_start: '00:00',
                            warmup_send_window_end: '00:00'
                          });
                        } else {
                          setSettings({
                            ...settings,
                            warmup_send_window_start: '08:00',
                            warmup_send_window_end: '18:00'
                          });
                        }
                      }} 
                    />
                  </div>
                  <div className={`grid grid-cols-2 gap-4 transition-opacity ${settings.warmup_send_window_start === settings.warmup_send_window_end ? 'opacity-50 pointer-events-none' : ''}`}>
                     <div className="space-y-2">
                        <Label>Start Time</Label>
                        <Input type="time" value={settings.warmup_send_window_start} onChange={e => setSettings({...settings, warmup_send_window_start: e.target.value})} />
                     </div>
                     <div className="space-y-2">
                        <Label>End Time</Label>
                        <Input type="time" value={settings.warmup_send_window_end} onChange={e => setSettings({...settings, warmup_send_window_end: e.target.value})} />
                     </div>
                  </div>
                  <div className="space-y-2">
                     <Label>Active Days</Label>
                     <div className="flex flex-wrap gap-3 pt-2">
                        {days.map(d => (
                          <div key={d} className="flex items-center gap-2">
                             <Checkbox 
                                id={`day-${d}`} 
                                checked={settings.warmup_active_days?.includes(d)} 
                                onCheckedChange={(checked: boolean) => {
                                   const newDays = checked 
                                     ? [...(settings.warmup_active_days || []), d]
                                     : (settings.warmup_active_days || []).filter((day: string) => day !== d);
                                   setSettings({...settings, warmup_active_days: newDays});
                                }}
                             />
                             <Label htmlFor={`day-${d}`} className="text-sm cursor-pointer">{d}</Label>
                          </div>
                        ))}
                     </div>
                  </div>
               </CardContent>
            </Card>
         </div>

          <div className="space-y-6">
            <Card className="border-teal-100 dark:border-teal-900 shadow-sm">
               <CardHeader className="bg-teal-50/50 dark:bg-teal-900/10">
                  <CardTitle className="flex items-center gap-2 text-teal-600">
                    <ShieldCheck className="w-5 h-5" /> Safety & Logic
                  </CardTitle>
                  <CardDescription>Intelligent deliverability filters & automation</CardDescription>
               </CardHeader>
               <CardContent className="space-y-6 pt-6">
                  <div className="flex items-center justify-between">
                     <div className="space-y-0.5">
                        <Label className="text-base">Auto Spam Rescue</Label>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-teal-500" />
                          Automatically moves emails from Junk to Inbox
                        </p>
                     </div>
                     <Switch 
                        checked={settings.warmup_auto_rescue} 
                        onCheckedChange={(checked) => setSettings({...settings, warmup_auto_rescue: checked})} 
                     />
                  </div>
                  
                  <div className="flex items-center justify-between">
                     <div className="space-y-0.5">
                        <Label className="text-base">Smart Auto-Reply</Label>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <RefreshCw className="w-3 h-3 text-blue-500" />
                          Simulates natural conversation patterns
                        </p>
                     </div>
                     <Switch 
                        checked={settings.warmup_auto_reply} 
                        onCheckedChange={(checked) => setSettings({...settings, warmup_auto_reply: checked})} 
                     />
                  </div>

                  <div className="flex items-center justify-between">
                     <div className="space-y-0.5">
                        <Label className="text-base">Auto-Pause on Bounce</Label>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-orange-500" />
                          Safeguard reputation if bounce rate spikes
                        </p>
                     </div>
                     <Switch 
                        checked={settings.warmup_auto_pause} 
                        onCheckedChange={(checked) => setSettings({...settings, warmup_auto_pause: checked})} 
                     />
                  </div>
               </CardContent>
            </Card>

            <div className="pt-4">
               <Button className="w-full py-7 text-lg bg-teal-600 hover:bg-teal-700 shadow-lg shadow-teal-500/20" onClick={handleSave} disabled={loading}>
                  {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Save className="w-5 h-5 mr-2" />}
                  Apply Settings
               </Button>
            </div>
         </div>
      </div>
    </div>
  );
}
