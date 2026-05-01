import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { toast } from 'sonner';
import { WarmupNav } from './WarmupDashboard';
import api from '@/lib/api';

export default function LogsTable() {
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [type, setType] = useState('All');
  const limit = 20;

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const { data } = await api.get(`/warmup/logs?type=${type}&limit=${limit}&offset=${page * limit}`);
      setLogs(data.logs || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      toast.error('Failed to load logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [page, type]);

  const exportCSV = () => {
    const headers = ['Date', 'Event', 'From', 'To', 'Result', 'MessageID'];
    const csvContent = "data:text/csv;charset=utf-8," 
      + headers.join(",") + "\n"
      + logs.map(l => `${l.created_at},${l.event_type},${l.from_email},${l.to_email},${l.result},${l.message_id}`).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `warmup_logs_${new Date().toISOString()}.csv`);
    document.body.appendChild(link);
    link.click();
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <WarmupNav />
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold font-outfit">Warmup Logs</h1>
          <p className="text-muted-foreground">Audit trail for all warmup events and interactions</p>
        </div>
        <Button variant="outline" onClick={exportCSV}>
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
           <CardTitle className="text-lg">Event History</CardTitle>
           <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                 <Filter className="w-4 h-4" /> Filter by type:
              </div>
              <Select value={type} onValueChange={(v: string) => { setType(v); setPage(0); }}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="All Events" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Events</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="replied">Replied</SelectItem>
                  <SelectItem value="rescue">Rescue</SelectItem>
                  <SelectItem value="bounce">Bounce</SelectItem>
                </SelectContent>
              </Select>
           </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Result / Message ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={5} className="text-center py-8">Loading...</TableCell></TableRow>}
              {!loading && logs.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No logs found.</TableCell></TableRow>}
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-xs text-muted-foreground uppercase">
                    {new Date(log.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant={
                      log.event_type === 'sent' ? 'default' : 
                      log.event_type === 'rescue' ? 'outline' : 
                      log.event_type === 'bounce' ? 'destructive' : 'secondary'
                    } className="capitalize">
                      {log.event_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm font-medium">{log.from_email}</TableCell>
                  <TableCell className="text-sm font-medium">{log.to_email}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                     {log.result || log.message_id || '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between p-4 border-t">
             <div className="text-sm text-muted-foreground">
                Showing {page * limit + 1} to {Math.min((page + 1) * limit, total)} of {total} logs
             </div>
             <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
                   <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="icon" onClick={() => setPage(p => p + 1)} disabled={(page + 1) * limit >= total}>
                   <ChevronRight className="w-4 h-4" />
                </Button>
             </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
