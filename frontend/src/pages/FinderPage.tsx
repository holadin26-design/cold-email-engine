import { useState, useRef } from 'react';
import { Search, Loader2, Check, AlertTriangle, Copy, UserPlus, Mail, Sparkles, ArrowRight, ShieldCheck, Download, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import api from "@/lib/api";

type StatusType = 'valid' | 'invalid' | 'risky' | 'unknown' | 'pending' | 'skipped';
type EmailResult = {
    email: string;
    status: StatusType;
    message?: string;
    confidence?: string;
    recommendation?: string;
};
type BulkResult = {
    id: string;
    input: string;
    email: string;
    status: StatusType;
    message?: string;
    confidence?: string;
};

const verifyEmailsExternal = async (emails: string[], signal: AbortSignal) => {
    try {
        const { data } = await api.post('/finder/verify-bulk', { emails }, { signal });

        // Backend returns { results: [...] } — normalise to the shape callers expect
        const results = (data.results || []).map((r: any) => ({
            email: r.email,
            status: r.status as StatusType,
            message: r.message,
            confidence: r.confidence,
            recommendation: r.recommendation,
        }));

        return { data: { results } };
    } catch (err: any) {
        if (err.name === 'AbortError' || err.name === 'CanceledError') throw err;
        return {
            data: {
                results: emails.map(email => ({
                    email,
                    status: 'invalid' as StatusType,
                    message: 'Validation error',
                    confidence: 'Low',
                    recommendation: 'Do not send'
                }))
            }
        };
    }
};

export default function FinderPage() {
    const [activeTab, setActiveTab] = useState('single');

    // --- Single Finder State ---
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [domain, setDomain] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [results, setResults] = useState<EmailResult[]>([]);
    const [savedEmails, setSavedEmails] = useState<Set<string>>(new Set());
    const [filter, setFilter] = useState<'all' | 'valid'>('all');

    // --- Bulk Finder State ---
    const [finderInput, setFinderInput] = useState('');
    const [finderResults, setFinderResults] = useState<BulkResult[]>([]);
    const [isBulkFinding, setIsBulkFinding] = useState(false);
    const skipTargetsRef = useRef<Set<number>>(new Set());
    const activeIndicesRef = useRef<Set<number>>(new Set());

    // --- Bulk Validator State ---
    const [validatorInput, setValidatorInput] = useState('');
    const [validatorResults, setValidatorResults] = useState<BulkResult[]>([]);
    const [isValidating, setIsValidating] = useState(false);
    const skipValidatorIndicesRef = useRef<Set<number>>(new Set());
    const activeValidatorIndicesRef = useRef<Set<number>>(new Set());

    const abortControllerRef = useRef<AbortController | null>(null);

    // --- Single Finder Logic ---
    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!firstName || !lastName || !domain) {
            toast.error("Please fill in all fields");
            return;
        }

        if (abortControllerRef.current) abortControllerRef.current.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;

        setIsSearching(true);
        setResults([]);
        setFilter('all');

        try {
            const { data: { patterns } } = await api.post("/finder/patterns", { firstName, lastName, domain });
            setResults(patterns.map((p: string) => ({ email: p, status: 'unknown' as StatusType })));

            try {
                const { data } = await verifyEmailsExternal(patterns, controller.signal);
                if (!controller.signal.aborted && data?.results) {
                    setResults(patterns.map((p: string) => {
                        const verified = data.results.find((r: any) => r.email === p);
                        return {
                            email: p,
                            status: verified?.status || 'invalid',
                            message: verified?.message,
                            confidence: verified?.confidence,
                            recommendation: verified?.recommendation
                        };
                    }));
                }
            } catch (err: any) {
                if (err.name !== 'CanceledError') {
                    console.error("Bulk verification failed:", err);
                    toast.error("Verification failed");
                }
            }
        } catch (err: any) {
            toast.error("Failed to generate patterns");
        } finally {
            if (!controller.signal.aborted) setIsSearching(false);
        }
    };

    // --- Bulk Finder Logic ---
    const handleBulkFind = async () => {
        if (!finderInput.trim()) return;

        const lines = finderInput.split('\n').filter(l => l.trim().length > 0);
        const parsedTargets = lines.map((line, i) => {
            const parts = line.split(/[,|\t]+/);
            if (parts.length >= 2) {
                const nameParts = parts[0].trim().split(' ');
                return {
                    index: i,
                    original: line,
                    firstName: nameParts[0] || '',
                    lastName: nameParts.slice(1).join(' ') || '',
                    domain: parts[1].trim()
                };
            }
            return null;
        }).filter((t): t is any => t !== null);

        if (parsedTargets.length === 0) {
            toast.error('Please use format: First Last, domain.com');
            return;
        }

        if (abortControllerRef.current) abortControllerRef.current.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;

        setIsBulkFinding(true);
        setFinderResults(parsedTargets.map((t, i) => ({
            id: `f-${i}`,
            input: t!.original,
            email: 'Generating patterns...',
            status: 'pending'
        })));

        const TARGET_CONCURRENCY = 5; // Restored to 5 for faster processing
        skipTargetsRef.current.clear();
        activeIndicesRef.current.clear();

        const processTarget = async (target: any) => {
            const targetIndex = target.index;
            if (controller.signal.aborted) return null;

            activeIndicesRef.current.add(targetIndex);

            const MAX_RETRIES = 2;
            try {
                for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                    if (controller.signal.aborted) return null;
                    if (skipTargetsRef.current.has(targetIndex)) {
                        setFinderResults(prev => prev.map(r => r.id === `f-${targetIndex}` ? { ...r, email: 'Skipped by user', status: 'skipped' } : r));
                        return { status: 'skipped' };
                    }

                    try {
                        // Initial status update
                        setFinderResults(prev => prev.map(r => r.id === `f-${targetIndex}` ? { ...r, email: attempt > 0 ? `Retrying (${attempt}/${MAX_RETRIES})...` : 'Generating patterns...', status: 'unknown' } : r));

                        const { data: { patterns } } = await api.post("/finder/patterns", {
                            firstName: target.firstName,
                            lastName: target.lastName,
                            domain: target.domain
                        });

                        if (controller.signal.aborted || skipTargetsRef.current.has(targetIndex)) return null;

                        setFinderResults(prev => prev.map(r => r.id === `f-${targetIndex}` ? { ...r, email: `Verifying ${patterns.length} patterns...`, status: 'unknown' } : r));

                        const { data } = await verifyEmailsExternal(patterns, controller.signal);

                        if (controller.signal.aborted) return null;

                        if (skipTargetsRef.current.has(targetIndex)) {
                            setFinderResults(prev => prev.map(r => r.id === `f-${targetIndex}` ? { ...r, email: 'Skipped by user', status: 'skipped' } : r));
                            return { status: 'skipped' };
                        }

                        // Find valid first, then risky
                        let bestMatch = data?.results?.find((r: any) => r.status === 'valid');
                        if (!bestMatch) {
                            bestMatch = data?.results?.find((r: any) => r.status === 'risky');
                        }

                        if (bestMatch) {
                            setFinderResults(prev => prev.map(r => r.id === `f-${targetIndex}` ? { ...r, email: bestMatch.email, status: bestMatch.status, message: bestMatch.message } : r));
                            return bestMatch;
                        } else {
                            setFinderResults(prev => prev.map(r => r.id === `f-${targetIndex}` ? { ...r, email: 'No valid email found', status: 'invalid' } : r));
                            return { status: 'invalid' };
                        }
                    } catch (err: any) {
                        if (controller.signal.aborted || err.name === 'CanceledError') return null;
                        const isNetworkError = err.code === 'ERR_NETWORK' || err.message?.includes('Network Error') || err.response?.status >= 500;
                        if (isNetworkError && attempt < MAX_RETRIES) {
                            await new Promise(resolve => setTimeout(resolve, 2000 * Math.pow(2, attempt)));
                            continue;
                        }
                        console.error("Target processing failed", err);
                        const errMsg = err.response?.data?.message || err.message || 'Network error';
                        setFinderResults(prev => prev.map(r => r.id === `f-${targetIndex}` ? { ...r, email: 'Failed', status: 'invalid', message: errMsg } : r));
                        return { status: 'invalid', message: errMsg };
                    }
                }
            } finally {
                activeIndicesRef.current.delete(targetIndex);
            }
            return null;
        };

        let nextIndex = 0;
        const worker = async () => {
            while (nextIndex < parsedTargets.length && !controller.signal.aborted) {
                const target = parsedTargets[nextIndex++];
                if (!target) break;

                await processTarget(target);
                
                if (!controller.signal.aborted) {
                    // Small constant delay to avoid absolute bursts but keep it fast
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            }
        };

        // Start workers
        const workers = Array.from({ length: Math.min(TARGET_CONCURRENCY, parsedTargets.length) }, () => worker());
        await Promise.all(workers);

        if (!controller.signal.aborted) setIsBulkFinding(false);
    };

    const handleSkipCurrent = () => {
        // Add all currently active indices to the skip set
        if (activeTab === 'bulk') {
            activeIndicesRef.current.forEach(idx => skipTargetsRef.current.add(idx));
        } else if (activeTab === 'validator') {
            activeValidatorIndicesRef.current.forEach(idx => skipValidatorIndicesRef.current.add(idx));
        }
    };

    // --- Bulk Validator Logic ---
    const handleBulkValidate = async () => {
        if (!validatorInput.trim()) return;

        const emailRegex = /([a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
        const emails = validatorInput.match(emailRegex) || [];
        const uniqueEmails = Array.from(new Set(emails.map(e => e.toLowerCase())));

        if (uniqueEmails.length === 0) {
            toast.error('No valid emails found in your input.');
            return;
        }

        if (abortControllerRef.current) abortControllerRef.current.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;

        setIsValidating(true);
        setValidatorResults(uniqueEmails.map((email, i) => ({
            id: `v-${i}`,
            input: email,
            email,
            status: 'pending' as StatusType
        })));

        try {
            // Send all emails in one batch
            const { data } = await verifyEmailsExternal(uniqueEmails, controller.signal);

            if (controller.signal.aborted) return;

            if (data?.results) {
                setValidatorResults(uniqueEmails.map((email, i) => {
                    const result = data.results.find((r: any) => r.email === email);
                    return {
                        id: `v-${i}`,
                        input: email,
                        email,
                        status: (result?.status as StatusType) || 'invalid',
                        message: result?.message
                    };
                }));
            }
        } catch (err: any) {
            if (!controller.signal.aborted && err.name !== 'CanceledError') {
                toast.error('Verification failed: ' + (err.response?.data?.error || err.message));
                setValidatorResults(prev => prev.map(r => ({ ...r, status: 'invalid' as StatusType, message: 'Request failed' })));
            }
        } finally {
            if (!controller.signal.aborted) setIsValidating(false);
        }
    };

    const exportCSV = (results: BulkResult[], filename: string) => {
        const csvContent = "Input,Email,Status,Message\n"
            + results.map(r => `"${r.input}","${r.email}","${r.status}","${r.message || ''}"`).join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const saveToLeads = (email: string) => {
        setSavedEmails(prev => new Set(prev).add(email));
        toast.success(`Saved ${email} to leads`);
    };

    const getStatusBadge = (status: StatusType, message?: string) => {
        if (status === 'valid') {
            return (
                <div className="flex flex-col gap-1">
                    <Badge className="bg-green-600 text-[10px] h-5 gap-1 w-fit">
                        <Check className="h-3 w-3" /> Verified
                    </Badge>
                    {message && <p className="text-[9px] text-muted-foreground">{message}</p>}
                </div>
            );
        }

        if (status === 'risky') {
            return (
                <div className="flex flex-col gap-1">
                    <Badge variant="outline" className="text-yellow-600 border-yellow-600/30 text-[10px] h-5 gap-1 w-fit">
                        <AlertTriangle className="h-3 w-3" /> Possible
                    </Badge>
                    {message && <p className="text-[9px] text-muted-foreground">{message}</p>}
                </div>
            );
        }

        if (status === 'invalid') {
            return (
                <div className="flex flex-col gap-1">
                    <Badge variant="destructive" className="text-[10px] h-5 w-fit">
                        Not Found
                    </Badge>
                    {message && <p className="text-[9px] text-muted-foreground">{message}</p>}
                </div>
            );
        }

        if (status === 'unknown') {
            return (
                <Badge variant="outline" className="text-blue-500 border-blue-500/30 text-[10px] h-5 gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> Verifying
                </Badge>
            );
        }

        if (status === 'skipped') {
            return (
                <Badge variant="secondary" className="text-[10px] h-5 gap-1">
                    <ArrowRight className="h-3 w-3" /> Skipped
                </Badge>
            );
        }

        return <Badge variant="outline" className="text-[10px] h-5 text-muted-foreground">Pending</Badge>;
    };

    const getRecommendationColor = (status: StatusType) => {
        if (status === 'valid') return 'border-green-500/30 bg-green-500/5';
        if (status === 'risky') return 'border-yellow-500/30 bg-yellow-500/5';
        if (status === 'invalid') return 'border-red-500/30 bg-red-500/5';
        return 'border-border';
    };

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            <div className="flex justify-between items-start">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Email Finder & Validator</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Discover and verify professional email addresses with enterprise-grade accuracy.
                    </p>
                </div>
            </div>

            <Tabs defaultValue="single" value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                <TabsList className="bg-muted/50 p-1">
                    <TabsTrigger value="single" className="gap-2"><UserPlus className="h-4 w-4" /> Single Finder</TabsTrigger>
                    <TabsTrigger value="bulk" className="gap-2"><Search className="h-4 w-4" /> Bulk Finder</TabsTrigger>
                    <TabsTrigger value="validator" className="gap-2"><ShieldCheck className="h-4 w-4" /> Bulk Validator</TabsTrigger>
                </TabsList>

                {/* --- SINGLE FINDER TAB --- */}
                <TabsContent value="single" className="space-y-6">
                    <Card className="border-primary/20 bg-primary/5">
                        <CardContent className="pt-6">
                            <form onSubmit={handleSearch} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold uppercase text-muted-foreground tracking-wider">First Name</label>
                                    <Input
                                        placeholder="John"
                                        value={firstName}
                                        onChange={e => setFirstName(e.target.value)}
                                        disabled={isSearching}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold uppercase text-muted-foreground tracking-wider">Last Name</label>
                                    <Input
                                        placeholder="Doe"
                                        value={lastName}
                                        onChange={e => setLastName(e.target.value)}
                                        disabled={isSearching}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold uppercase text-muted-foreground tracking-wider">Domain</label>
                                    <Input
                                        placeholder="company.com"
                                        value={domain}
                                        onChange={e => setDomain(e.target.value)}
                                        disabled={isSearching}
                                    />
                                </div>
                                <Button type="submit" disabled={isSearching} className="w-full">
                                    {isSearching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
                                    Find Email
                                </Button>
                            </form>
                        </CardContent>
                    </Card>

                    {results.length > 0 && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
                            <div className="flex items-center justify-between">
                                <h2 className="text-lg font-semibold">Results</h2>
                                <div className="flex bg-muted rounded-lg p-1">
                                    <button
                                        onClick={() => setFilter('all')}
                                        className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${filter === 'all' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
                                    >
                                        All ({results.length})
                                    </button>
                                    <button
                                        onClick={() => setFilter('valid')}
                                        className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${filter === 'valid' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
                                    >
                                        Verified ({results.filter(r => r.status === 'valid').length})
                                    </button>
                                </div>
                            </div>
                            <div className="grid gap-3">
                                {results.filter(r => filter === 'all' || r.status === 'valid').map((res, i) => (
                                    <div
                                        key={i}
                                        className={`flex items-center justify-between p-4 rounded-xl border transition-all hover:shadow-md bg-card ${getRecommendationColor(res.status)}`}
                                    >
                                        <div className="flex items-center gap-4 flex-1">
                                            <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${res.status === 'valid' ? 'bg-green-100 text-green-600' :
                                                res.status === 'risky' ? 'bg-yellow-100 text-yellow-600' :
                                                    'bg-primary/10 text-primary'
                                                }`}>
                                                {res.status === 'valid' ? <Check className="h-5 w-5" /> :
                                                    res.status === 'risky' ? <AlertTriangle className="h-5 w-5" /> :
                                                        res.status === 'unknown' ? <Loader2 className="h-5 w-5 animate-spin" /> :
                                                            <Mail className="h-5 w-5" />}
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                    <p className="font-medium text-sm">{res.email}</p>
                                                    {getStatusBadge(res.status, res.message)}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => {
                                                    navigator.clipboard.writeText(res.email);
                                                    toast.success("Copied!");
                                                }}
                                            >
                                                <Copy className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={savedEmails.has(res.email) || res.status === 'invalid' || res.status === 'unknown'}
                                                onClick={() => saveToLeads(res.email)}
                                            >
                                                {savedEmails.has(res.email) ? <Check className="h-3.5 w-3.5 mr-1" /> : <UserPlus className="h-3.5 w-3.5 mr-1" />}
                                                {savedEmails.has(res.email) ? 'Saved' : 'Save'}
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </TabsContent>

                {/* --- BULK FINDER TAB --- */}
                <TabsContent value="bulk" className="space-y-6">
                    <Card>
                        <CardHeader className="py-4">
                            <CardTitle className="text-sm font-medium flex items-center gap-2">
                                <Search className="h-4 w-4 text-primary" /> Multi-Lead Input
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="bg-muted p-3 rounded-lg flex gap-3 text-xs text-muted-foreground">
                                <AlertTriangle className="h-4 w-4 text-primary flex-shrink-0" />
                                <p>Enter leads as: <strong className="text-foreground italic">First Last, domain.com</strong> (one per line). We'll verify with automatic delays to avoid rate limiting.</p>
                            </div>
                            <Textarea
                                value={finderInput}
                                onChange={e => setFinderInput(e.target.value)}
                                placeholder={"John Doe, google.com\nJane Smith, microsoft.com\nBob Wilson, startup.io"}
                                className="min-h-[180px] font-mono text-sm"
                                disabled={isBulkFinding}
                            />
                            <div className="flex justify-end gap-3">
                                {isBulkFinding && <Button variant="outline" onClick={handleSkipCurrent}>Skip Current</Button>}
                                <Button onClick={handleBulkFind} disabled={isBulkFinding || !finderInput.trim()}>
                                    {isBulkFinding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                                    Start Bulk Find
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {finderResults.length > 0 && (
                        <Card className="overflow-hidden">
                            <div className="flex justify-between items-center p-4 border-b">
                                <h3 className="text-sm font-bold">Bulk Results ({finderResults.filter(r => r.status === 'valid').length} verified)</h3>
                                <Button variant="outline" size="sm" onClick={() => exportCSV(finderResults, 'finder_results.csv')}>
                                    <Download className="h-3.5 w-3.5 mr-2" /> Export CSV
                                </Button>
                            </div>
                            <div className="overflow-x-auto max-h-[400px]">
                                <table className="w-full text-xs text-left">
                                    <thead className="bg-muted sticky top-0">
                                        <tr>
                                            <th className="p-3">Input Target</th>
                                            <th className="p-3">Email Found</th>
                                            <th className="p-3">Status</th>
                                            <th className="p-3">Message</th>
                                            <th className="p-3 text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {finderResults.map(res => (
                                            <tr key={res.id} className="hover:bg-muted/30">
                                                <td className="p-3 font-medium">{res.input}</td>
                                                <td className="p-3 font-mono text-primary">{res.email.length > 30 ? res.email.substring(0, 30) + '...' : res.email}</td>
                                                <td className="p-3">{getStatusBadge(res.status)}</td>
                                                <td className="p-3 text-muted-foreground text-[11px]">{res.message}</td>
                                                <td className="p-3 text-right">
                                                    {(res.status === 'valid' || res.status === 'risky') && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-7 w-7"
                                                            onClick={() => saveToLeads(res.email)}
                                                            disabled={savedEmails.has(res.email)}
                                                        >
                                                            <UserPlus className={`h-3.5 w-3.5 ${savedEmails.has(res.email) ? 'text-green-500' : ''}`} />
                                                        </Button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Card>
                    )}
                </TabsContent>

                {/* --- BULK VALIDATOR TAB --- */}
                <TabsContent value="validator" className="space-y-6">
                    <Card>
                        <CardHeader className="py-4">
                            <CardTitle className="text-sm font-medium flex items-center gap-2">
                                <ShieldCheck className="h-4 w-4 text-primary" /> SMTP Email Validator
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="bg-purple-50/50 p-3 rounded-lg flex gap-3 text-xs text-purple-800">
                                <Zap className="h-4 w-4 text-purple-500 flex-shrink-0" />
                                <p>Paste any text containing emails. We'll extract all unique addresses and verify them with proper retry logic for greylisting.</p>
                            </div>
                            <Textarea
                                value={validatorInput}
                                onChange={e => setValidatorInput(e.target.value)}
                                placeholder={"test@google.com\nhello@microsoft.com\njohn.doe@company.com"}
                                className="min-h-[180px] font-mono text-sm"
                                disabled={isValidating}
                            />
                            <div className="flex justify-end gap-3">
                                {isValidating && <Button variant="outline" onClick={handleSkipCurrent}>Skip Current</Button>}
                                <Button
                                    onClick={handleBulkValidate}
                                    disabled={isValidating || !validatorInput.trim()}
                                    className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white"
                                >
                                    {isValidating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                                    {isValidating ? 'Verifying...' : 'Extract & Verify Emails'}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {validatorResults.length > 0 && (
                        <Card className="overflow-hidden">
                            <div className="flex justify-between items-center p-4 border-b">
                                <h3 className="text-sm font-bold">Verification Results ({validatorResults.filter(r => r.status === 'valid').length} valid)</h3>
                                <Button variant="outline" size="sm" onClick={() => exportCSV(validatorResults, 'validation_results.csv')}>
                                    <Download className="h-3.5 w-3.5 mr-2" /> Export CSV
                                </Button>
                            </div>
                            <div className="overflow-x-auto max-h-[400px]">
                                <table className="w-full text-xs text-left">
                                    <thead className="bg-muted sticky top-0">
                                        <tr>
                                            <th className="p-3 w-2/5">Email Address</th>
                                            <th className="p-3">Status</th>
                                            <th className="p-3">Message</th>
                                            <th className="p-3 text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {validatorResults.map(res => (
                                            <tr key={res.id} className="hover:bg-muted/30">
                                                <td className="p-3 font-medium">{res.email}</td>
                                                <td className="p-3">{getStatusBadge(res.status)}</td>
                                                <td className="p-3 text-muted-foreground text-[11px]">{res.message}</td>
                                                <td className="p-3 text-right">
                                                    {(res.status === 'valid' || res.status === 'risky') && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-7 w-7"
                                                            onClick={() => saveToLeads(res.email)}
                                                            disabled={savedEmails.has(res.email)}
                                                        >
                                                            <UserPlus className={`h-3.5 w-3.5 ${savedEmails.has(res.email) ? 'text-green-500' : ''}`} />
                                                        </Button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Card>
                    )}
                </TabsContent>
            </Tabs>

            {!results.length && !finderResults.length && !validatorResults.length && (
                <div className="grid md:grid-cols-3 gap-4 pt-4">
                    <div className="p-6 rounded-2xl border bg-card/50 space-y-2">
                        <Sparkles className="h-5 w-5 text-blue-500" />
                        <h3 className="text-sm font-bold">Smart Pattern Matching</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">Generates 10+ email patterns with greylisting retry logic for maximum accuracy.</p>
                    </div>
                    <div className="p-6 rounded-2xl border bg-card/50 space-y-2">
                        <Check className="h-5 w-5 text-green-500" />
                        <h3 className="text-sm font-bold">Enterprise SMTP Validation</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">Real-time mailbox verification with multi-retry greylisting detection.</p>
                    </div>
                    <div className="p-6 rounded-2xl border bg-card/50 space-y-2">
                        <ArrowRight className="h-5 w-5 text-purple-500" />
                        <h3 className="text-sm font-bold">Bulk Export & Prioritization</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">Process 100+ leads at once with confidence scoring and CSV export.</p>
                    </div>
                </div>
            )}
        </div>
    );
}
