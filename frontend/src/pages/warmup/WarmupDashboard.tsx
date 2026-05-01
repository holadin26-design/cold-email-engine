import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar
} from 'recharts';
import { Flame, TrendingUp, Send, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Link, useLocation } from 'react-router-dom';
import api from '@/lib/api';

export function WarmupNav() {
  const location = useLocation();
  const links = [
    { name: 'Overview', path: '/warmup' },
    { name: 'Accounts', path: '/warmup/accounts' },
    { name: 'Seed Pool', path: '/warmup/seed-pool' },
    { name: 'Logs', path: '/warmup/logs' },
    { name: 'Settings', path: '/warmup/settings' },
  ];

  return (
    <div className="flex items-center gap-1 border-b mb-6">
      {links.map((link) => (
        <Link
          key={link.path}
          to={link.path}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            location.pathname === link.path
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
          }`}
        >
          {link.name}
        </Link>
      ))}
    </div>
  );
}

export default function WarmupDashboard() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/warmup/stats');
      setStats(data);
    } catch (err: any) {
      console.error('Fetch failed:', err);
      toast.error('Failed to load warmup stats');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const triggerWarmup = async () => {
    try {
      const { data } = await api.post('/warmup/trigger');
      if (data.success) {
        toast.success(`Warmup engine triggered at ${new Date(data.triggered_at).toLocaleTimeString()}`);
        fetchStats();
      } else {
        toast.error(data.error || 'Trigger failed');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Trigger failed');
    }
  };

  if (loading && !stats) return <div className="p-8">Loading Dashboard...</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <WarmupNav />
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold font-outfit">Warmup Dashboard</h1>
          <p className="text-muted-foreground">Monitor your sender reputation and warmup progress</p>
        </div>
        <div className="flex gap-4">
          <Button variant="outline" onClick={fetchStats} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={triggerWarmup} disabled={loading}>
            <Flame className="w-4 h-4 mr-2" />
            Trigger Run
          </Button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Avg. Reputation</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-teal-500">{stats?.avg_reputation}%</div>
            <Progress value={stats?.avg_reputation} className="mt-2 h-1 bg-teal-100 dark:bg-teal-900" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Sent Today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.sent_today}</div>
            <p className="text-xs text-muted-foreground mt-1">Across all active accounts</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Active Accounts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.active_accounts}</div>
            <p className="text-xs text-muted-foreground mt-1">Total enabled: {stats?.accounts?.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Pool Strength</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={stats?.pool_strength === 'strong' ? 'default' : 'secondary'} className="capitalize">
              {stats?.pool_strength}
            </Badge>
            <p className="text-xs text-muted-foreground mt-2">{stats?.seed_count} seed accounts in pool</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-teal-500" />
              Reputation History (Avg)
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats?.reputation_history || []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="recorded_at" hide />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Line type="monotone" dataKey="score" stroke="#14b8a6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Send className="w-5 h-5 text-blue-500" />
              Daily Send Volume
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats?.daily_sends_history || []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Accounts List (Simplified for Dashboard) */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Accounts Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {stats?.accounts?.map((acc: any) => (
                <div key={acc.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-bold text-xs uppercase">
                      {acc.type[0]}
                    </div>
                    <div>
                      <div className="font-medium text-sm">{acc.email}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                         <Badge variant={acc.warmup_status === 'active' ? 'default' : 'secondary'} className="h-4 text-[10px] leading-none">
                            {acc.warmup_status}
                         </Badge>
                         Ramp Day {acc.warmup_ramp_day}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-teal-500">{acc.warmup_reputation}%</div>
                    <Progress value={acc.warmup_reputation} className="w-24 h-1 mt-1" />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Activity Feed */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
             <div className="space-y-6">
                {stats?.recent_logs?.map((log: any) => (
                  <div key={log.id} className="flex gap-3 text-sm">
                    {log.event_type === 'sent' && <Send className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />}
                    {log.event_type === 'rescue' && <CheckCircle2 className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" />}
                    {log.event_type === 'replied' && <RefreshCw className="w-4 h-4 text-purple-500 shrink-0 mt-0.5" />}
                    {log.event_type === 'bounce' && <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />}
                    <div>
                      <p className="font-medium capitalize">{log.event_type}</p>
                      <p className="text-xs text-muted-foreground leading-snug">
                         {log.from_email} → {log.to_email}
                      </p>
                      <span className="text-[10px] text-muted-foreground uppercase">{new Date(log.created_at).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))}
             </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
