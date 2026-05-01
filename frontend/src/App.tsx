import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import Dashboard from "./pages/Dashboard";
import CampaignsPage from "./pages/CampaignsPage";
import AccountsPage from "./pages/AccountsPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import BulkSend from "./pages/BulkSend";
import LoginPage from "./pages/LoginPage";
import FollowupsPage from "./pages/FollowupsPage";
import UniboxPage from "./pages/UniboxPage";
import FinderPage from "./pages/FinderPage";
import WarmupDashboard from "./pages/warmup/WarmupDashboard";
import AccountsGrid from "./pages/warmup/AccountsGrid";
import SeedPool from "./pages/warmup/SeedPool";
import LogsTable from "./pages/warmup/LogsTable";
import ConnectWizard from "./pages/warmup/ConnectWizard";
import Settings from "./pages/warmup/Settings";
import WarmupCallback from "./pages/warmup/WarmupCallback";
import CampaignDetailsPage from "./pages/CampaignDetailsPage";
import { supabase } from "@/lib/supabase";
import api from "@/lib/api";
import { LayoutDashboard, Megaphone, Server, Activity, LogOut, User, MessageSquareReply, Inbox, Search, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";

function Sidebar({ onLogout, userEmail, replyCount }: { onLogout: () => void, userEmail?: string, replyCount: number }) {
  const location = useLocation();
  const isActive = (path: string) => location.pathname.startsWith(path) ? "bg-accent text-accent-foreground" : "hover:bg-muted";

  return (
    <div className="flex-1 w-full bg-background border-r border-border md:w-64 md:flex-none p-4 hidden md:flex flex-col h-screen">
      <div className="flex-1">
        <h1 className="text-xl font-bold mb-8 tracking-tight">Cold Email Engine</h1>
        <nav className="space-y-2 text-sm font-medium">
          <Link to="/" className={`flex items-center gap-2 p-2 rounded-md ${isActive('/') && location.pathname === '/' ? 'bg-accent' : 'hover:bg-muted'}`}><LayoutDashboard className="h-4 w-4" />Dashboard</Link>
          <Link to="/unibox" className={`flex items-center gap-2 p-2 rounded-md ${isActive('/unibox') ? 'bg-accent' : 'hover:bg-muted'}`}>
            <Inbox className="h-4 w-4" />
            Unibox
            {replyCount > 0 && (
              <span className="ml-auto bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full">{replyCount}</span>
            )}
          </Link>
          <Link to="/campaigns" className={`flex items-center gap-2 p-2 rounded-md ${isActive('/campaigns') ? 'bg-accent' : 'hover:bg-muted'}`}><Megaphone className="h-4 w-4" />Campaigns</Link>
          <Link to="/finder" className={`flex items-center gap-2 p-2 rounded-md ${isActive('/finder') ? 'bg-accent' : 'hover:bg-muted'}`}><Search className="h-4 w-4" />Email Finder</Link>
          <Link to="/accounts" className={`flex items-center gap-2 p-2 rounded-md ${isActive('/accounts') ? 'bg-accent' : 'hover:bg-muted'}`}><Server className="h-4 w-4" />Accounts & Limits</Link>
           <Link to="/warmup" className={`flex items-center gap-2 p-2 rounded-md ${isActive('/warmup') ? 'bg-accent' : 'hover:bg-muted'}`}>
            <Flame className="h-4 w-4" />
            Email Warmup
          </Link>
          {isActive('/warmup') && (
            <div className="ml-6 space-y-1 mb-2 border-l pl-2">
              <Link to="/warmup" className={`block p-1 text-xs rounded-md ${location.pathname === '/warmup' ? 'text-primary font-bold' : 'text-muted-foreground hover:text-foreground'}`}>Overview</Link>
              <Link to="/warmup/accounts" className={`block p-1 text-xs rounded-md ${location.pathname === '/warmup/accounts' ? 'text-primary font-bold' : 'text-muted-foreground hover:text-foreground'}`}>Accounts</Link>
              <Link to="/warmup/seed-pool" className={`block p-1 text-xs rounded-md ${location.pathname === '/warmup/seed-pool' ? 'text-primary font-bold' : 'text-muted-foreground hover:text-foreground'}`}>Seed Pool</Link>
              <Link to="/warmup/logs" className={`block p-1 text-xs rounded-md ${location.pathname === '/warmup/logs' ? 'text-primary font-bold' : 'text-muted-foreground hover:text-foreground'}`}>Logs</Link>
              <Link to="/warmup/settings" className={`block p-1 text-xs rounded-md ${location.pathname === '/warmup/settings' ? 'text-primary font-bold' : 'text-muted-foreground hover:text-foreground'}`}>Settings</Link>
            </div>
          )}
          <Link to="/analytics" className={`flex items-center gap-2 p-2 rounded-md ${isActive('/analytics') ? 'bg-accent' : 'hover:bg-muted'}`}><Activity className="h-4 w-4" />Analytics</Link>
          <Link to="/followups" className={`flex items-center gap-2 p-2 rounded-md ${isActive('/followups') ? 'bg-accent' : 'hover:bg-muted'}`}>
            <MessageSquareReply className="h-4 w-4" />
            Auto Follow-ups
          </Link>
        </nav>
      </div>

      <div className="pt-4 border-t space-y-4">
        <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground truncate">
          <User className="h-3 w-3" />
          {userEmail}
        </div>
        <Button variant="ghost" size="sm" className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10" onClick={onLogout}>
          <LogOut className="mr-2 h-4 w-4" /> Logout
        </Button>
      </div>
    </div>
  );
}

function App() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [replyCount, setReplyCount] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    const fetchReplyCount = async () => {
      try {
        const { data } = await api.get("/replies");
        setReplyCount((data || []).length);
      } catch (_) {}
    };
    fetchReplyCount();
    const interval = setInterval(fetchReplyCount, 60_000);
    return () => clearInterval(interval);
  }, [session]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  return (
    <Router>
      <div className="min-h-screen bg-background text-foreground flex md:flex-row flex-col">
        <Sidebar onLogout={handleLogout} userEmail={session?.user?.email || "User"} replyCount={replyCount} />
        <main className="flex-1 p-8 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/campaigns" element={<CampaignsPage />} />
            <Route path="/campaigns/new" element={<BulkSend />} />
            <Route path="/campaigns/:id" element={<CampaignDetailsPage />} />
            <Route path="/unibox" element={<UniboxPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/warmup" element={<WarmupDashboard />} />
            <Route path="/warmup/accounts" element={<AccountsGrid />} />
            <Route path="/warmup/seed-pool" element={<SeedPool />} />
            <Route path="/warmup/logs" element={<LogsTable />} />
            <Route path="/warmup/connect" element={<ConnectWizard />} />
            <Route path="/warmup/settings" element={<Settings />} />
            <Route path="/warmup/callback" element={<WarmupCallback />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/followups" element={<FollowupsPage />} />
            <Route path="/finder" element={<FinderPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
