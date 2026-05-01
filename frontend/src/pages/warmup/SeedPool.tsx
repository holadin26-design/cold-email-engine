import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Send, CheckCircle2, ShieldCheck, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { WarmupNav } from './WarmupDashboard';
import api from '@/lib/api';
import { supabase } from '@/lib/supabase';

export default function SeedPool() {
  const [seeds, setSeeds] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showLeadModal, setShowLeadModal] = useState(false);
  const [leadEmail, setLeadEmail] = useState('');
  const [savingLead, setSavingLead] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/warmup/stats');
      setSeeds(data.seeds || []);
      setStats(data);
    } catch (err: any) {
      toast.error('Failed to load seed pool');
    } finally {
      setLoading(false);
    }
  };

  const handleAddLead = async () => {
    if (!leadEmail || !leadEmail.includes('@')) {
      toast.error('Please enter a valid email');
      return;
    }
    setSavingLead(true);
    try {
      await api.post('/warmup/save-smtp', { email: leadEmail, role: 'seed', type: 'recipient', status: 'active' });
      toast.success('Warmup lead added successfully');
      setLeadEmail('');
      setShowLeadModal(false);
      fetchData();
    } catch (err: any) {
      toast.error('Failed to add lead');
    } finally {
      setSavingLead(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <WarmupNav />
      <div className="flex justify-between items-center">
        <div className="bg-slate-900 p-8 rounded-2xl border border-slate-800 shadow-xl mb-6">
          <h1 className="text-4xl font-bold font-outfit text-white mb-2">Warmup Seed Pool</h1>
          <p className="text-slate-400 font-medium text-lg italic">Monitor the health and activity of the worldwide seed network</p>
        </div>
        <div className="flex gap-4">
          <Button variant="outline" onClick={() => setShowLeadModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Warmup Lead
          </Button>
          <Button variant="outline" onClick={async () => {
            const { error } = await supabase.auth.signInWithOAuth({
              provider: 'google',
              options: {
                scopes: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.labels',
                queryParams: {
                  access_type: 'offline',
                  prompt: 'consent',
                },
                redirectTo: `${window.location.origin}/warmup/callback?role=seed`
              }
            });
            if (error) toast.error(error.message);
          }} className="bg-white/5 border-slate-700 text-slate-200 hover:bg-white/10">
            <Plus className="w-4 h-4 mr-2" />
            Connect Gmail
          </Button>
        </div>
      </div>

      {showLeadModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-2xl max-w-md w-full animate-in fade-in zoom-in duration-200 relative border border-slate-200 dark:border-slate-800">
            <button 
              onClick={() => setShowLeadModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
            <div className="mb-6">
              <h2 className="text-3xl font-black mb-1 text-slate-900 dark:text-white tracking-tight">Add Warmup Lead</h2>
              <p className="text-sm font-bold text-slate-500 dark:text-slate-400 italic">Emails added here will only receive warmup messages. No credentials required.</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Email Address</label>
                <input 
                  type="email" 
                  value={leadEmail} 
                  onChange={e => setLeadEmail(e.target.value)}
                  className="w-full p-3 border-2 border-slate-100 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:border-teal-500 outline-none transition-all"
                  placeholder="e.g. lead@example.com"
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-3 pt-6 border-t dark:border-slate-800">
                <Button variant="ghost" onClick={() => setShowLeadModal(false)} className="text-slate-600 dark:text-slate-400 font-bold hover:bg-slate-100 dark:hover:bg-slate-800">
                  Cancel
                </Button>
                <Button onClick={handleAddLead} disabled={savingLead} className="bg-teal-600 hover:bg-teal-700 text-white px-8 font-black shadow-lg shadow-teal-500/20">
                  {savingLead ? 'Adding...' : 'Add Lead'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-slate-900 border-slate-800 shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-black text-teal-500 uppercase tracking-[0.2em]">Pool Strength</CardTitle>
          </CardHeader>
          <CardContent>
             <div className="flex items-center gap-4">
                <div className="p-3 bg-teal-500/10 rounded-xl">
                  <ShieldCheck className="w-8 h-8 text-teal-400" />
                </div>
                <div>
                   <div className="text-3xl font-black text-white capitalize tracking-tight">{stats?.pool_strength || '...'}</div>
                   <p className="text-xs text-slate-400 font-bold mt-1">Global Network Scale</p>
                </div>
             </div>
          </CardContent>
        </Card>
        <Card className="bg-slate-900 border-slate-800 shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-black text-blue-500 uppercase tracking-[0.2em]">Total Rescues</CardTitle>
          </CardHeader>
          <CardContent>
             <div className="text-4xl font-black text-white tracking-tighter">
                {seeds.reduce((acc, curr) => acc + (curr.spam_rescued_total || 0), 0)}
             </div>
             <p className="text-xs text-slate-400 font-bold mt-1">Emails saved from Spam</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-900 border-slate-800 shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-black text-purple-500 uppercase tracking-[0.2em]">Daily Exchanges</CardTitle>
          </CardHeader>
          <CardContent>
             <div className="text-4xl font-black text-white tracking-tighter">
                {seeds.reduce((acc, curr) => acc + (curr.daily_sent || 0) + (curr.daily_received || 0), 0)}
             </div>
             <p className="text-xs text-slate-400 font-bold mt-1">Last 24 hours activity</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-8">
        <Card className="bg-slate-900 border-slate-800 shadow-xl overflow-hidden">
          <CardHeader className="border-b border-slate-800 bg-slate-950/50 p-6">
            <CardTitle className="text-xl flex items-center gap-3 text-white font-bold">
              <div className="p-2 bg-teal-500/10 rounded-lg">
                <CheckCircle2 className="w-6 h-6 text-teal-400" />
              </div>
              Active Seed Pool
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-950 hover:bg-slate-950 border-b border-slate-800">
                  <TableHead className="py-4 px-6 font-bold text-slate-300 uppercase text-[10px] tracking-widest">Seed Email</TableHead>
                  <TableHead className="py-4 px-6 font-bold text-slate-300 uppercase text-[10px] tracking-widest">Type</TableHead>
                  <TableHead className="py-4 px-6 font-bold text-slate-300 uppercase text-[10px] tracking-widest">Activity (S/R)</TableHead>
                  <TableHead className="py-4 px-6 font-bold text-slate-300 uppercase text-[10px] tracking-widest">Efficiency</TableHead>
                  <TableHead className="py-4 px-6 font-bold text-slate-300 uppercase text-[10px] tracking-widest">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && <TableRow><TableCell colSpan={5} className="text-center py-12 text-slate-500 font-bold animate-pulse italic">Gathering network data...</TableCell></TableRow>}
                {!loading && seeds.filter(s => s.type !== 'recipient').length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center py-12 text-slate-500 font-medium">No active seed accounts connected.</TableCell></TableRow>
                )}
                {seeds.filter(s => s.type !== 'recipient').map((seed) => (
                  <TableRow key={seed.id} className="hover:bg-slate-800/50 border-b border-slate-800 transition-colors">
                    <TableCell className="py-4 px-6 font-semibold text-slate-200">{seed.email}</TableCell>
                    <TableCell className="py-4 px-6">
                      <Badge variant="outline" className="uppercase text-[10px] font-black border-slate-700 text-slate-400 bg-slate-800/50">{seed.type}</Badge>
                    </TableCell>
                    <TableCell className="py-4 px-6">
                      <div className="flex items-center gap-6 text-sm font-black">
                         <span className="flex items-center gap-2 text-blue-400"><Send className="w-4 h-4"/> {seed.daily_sent}</span>
                         <span className="flex items-center gap-2 text-teal-400"><CheckCircle2 className="w-4 h-4"/> {seed.daily_received}</span>
                      </div>
                    </TableCell>
                    <TableCell className="py-4 px-6 text-sm font-black text-teal-400 tracking-wider">
                       {seed.spam_rescued_total} Rescue pts
                    </TableCell>
                    <TableCell className="py-4 px-6">
                      <Badge className={seed.status === 'active' ? 'bg-teal-600 hover:bg-teal-700 text-white border-none px-4 py-1' : 'bg-slate-800 text-slate-500 border-none'}>
                        {seed.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-blue-900/30 shadow-2xl overflow-hidden ring-1 ring-blue-500/10">
          <CardHeader className="border-b border-slate-800 bg-blue-950/20 p-6">
            <div className="flex justify-between items-center">
              <CardTitle className="text-xl flex items-center gap-3 text-blue-100 font-bold">
                <div className="p-2 bg-blue-500/10 rounded-lg">
                  <ShieldCheck className="w-6 h-6 text-blue-400" />
                </div>
                Warmup Leads (Target Pool)
              </CardTitle>
              <Badge className="bg-blue-600/20 text-blue-400 border-blue-500/30 px-3 uppercase text-[10px] font-black">Strict Verification Active</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-950 hover:bg-slate-950 border-b border-slate-800">
                  <TableHead className="py-4 px-6 font-bold text-slate-300 uppercase text-[10px] tracking-widest">Target Email</TableHead>
                  <TableHead className="py-4 px-6 font-bold text-slate-300 uppercase text-[10px] tracking-widest">Arrivals Today</TableHead>
                  <TableHead className="py-4 px-6 font-bold text-slate-300 uppercase text-[10px] tracking-widest">Cumulative Warmth</TableHead>
                  <TableHead className="py-4 px-6 font-bold text-slate-300 uppercase text-[10px] tracking-widest">Verification Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!loading && seeds.filter(s => s.type === 'recipient').length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center py-20 text-slate-500 font-semibold italic">No warmup leads present in target pool. Add them to begin automatic warming.</TableCell></TableRow>
                )}
                {seeds.filter(s => s.type === 'recipient').map((seed) => (
                  <TableRow key={seed.id} className="hover:bg-blue-900/10 border-b border-slate-800/50 transition-colors">
                    <TableCell className="py-5 px-6 font-bold text-slate-100">{seed.email}</TableCell>
                    <TableCell className="py-5 px-6">
                      <span className="text-xl font-black text-blue-400 tracking-tighter">{seed.daily_received}</span>
                    </TableCell>
                    <TableCell className="py-5 px-6">
                      <span className="text-sm font-black text-teal-400">Validated ✺</span>
                    </TableCell>
                    <TableCell className="py-5 px-6">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div>
                        <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Receiving Active</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
