import { useEffect, useState } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Pause, Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { WarmupNav } from './WarmupDashboard';
import api from '@/lib/api';

export default function AccountsGrid() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/warmup/stats');
      setAccounts(data.accounts || []);
    } catch (err: any) {
      toast.error('Failed to load accounts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handlePause = async (id: string) => {
    try {
      await api.post(`/warmup/accounts/${id}/pause`);
      toast.success('Warmup paused');
      fetchData();
    } catch (err: any) {
      toast.error('Action failed');
    }
  };

  const handleResume = async (id: string) => {
    try {
      await api.post(`/warmup/accounts/${id}/resume`);
      toast.success('Warmup resumed');
      fetchData();
    } catch (err: any) {
      toast.error('Action failed');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this account from Warmup? This will delete all logs and history.')) return;
    try {
      await api.delete(`/warmup/accounts/${id}`);
      toast.success('Account deleted from WarmGrid');
      fetchData();
    } catch (err: any) {
      toast.error('Delete failed');
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <WarmupNav />
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold font-outfit">Warmup Accounts</h1>
          <p className="text-muted-foreground">Manage your primary sending accounts and their warmup status</p>
        </div>
        <Button onClick={() => window.location.href = '/warmup/connect'}>
          Add Account
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email & Type</TableHead>
                <TableHead>Reputation</TableHead>
                <TableHead>Ramp Progress</TableHead>
                <TableHead>Sent Today</TableHead>
                <TableHead>Last Active</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={7} className="text-center py-8">Loading...</TableCell></TableRow>}
              {!loading && accounts.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No accounts connected yet.</TableCell></TableRow>}
              {accounts.map((acc) => (
                <TableRow key={acc.id}>
                  <TableCell>
                    <div className="font-medium">{acc.email}</div>
                    <div className="text-xs text-muted-foreground uppercase">{acc.type}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-teal-500">{acc.warmup_reputation}%</span>
                      <Progress value={acc.warmup_reputation} className="w-16 h-1" />
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">Ramp Day {acc.warmup_ramp_day}</div>
                    <div className="text-xs text-muted-foreground">Target: {acc.warmup_ramp_target}d</div>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{acc.warmup_daily_sent}</span>
                    <span className="text-xs text-muted-foreground"> / {acc.warmup_daily_limit}</span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground uppercase">
                    {acc.warmup_last_active ? new Date(acc.warmup_last_active).toLocaleTimeString() : 'Never'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={acc.warmup_status === 'active' ? 'default' : acc.warmup_status === 'paused' ? 'outline' : 'secondary'}>
                      {acc.warmup_status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {acc.warmup_status === 'active' ? (
                        <Button variant="ghost" size="icon" onClick={() => handlePause(acc.id)} title="Pause Warmup">
                          <Pause className="w-4 h-4" />
                        </Button>
                      ) : (
                        <Button variant="ghost" size="icon" onClick={() => handleResume(acc.id)} title="Resume Warmup">
                          <Play className="w-4 h-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(acc.id)} className="text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
