import { useState, useEffect } from "react";
import Papa from "papaparse";
import { Upload, Eye, Send, FileText, Settings, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import api from "@/lib/api";
import { useNavigate } from "react-router-dom";

const STEPS = [
    { num: 1, label: "Campaign Info", icon: Settings },
    { num: 2, label: "Upload Leads", icon: Upload },
    { num: 3, label: "Template", icon: FileText },
    { num: 4, label: "Confirm", icon: Eye }
];

export default function BulkSend() {
    const navigate = useNavigate();
    const [step, setStep] = useState(1);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Form State
    const [name, setName] = useState("");
    const [delayMin, setDelayMin] = useState(60);
    const [delayMax, setDelayMax] = useState(120);
    const [csvRaw, setCsvRaw] = useState("");
    const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
    const [csvData, setCsvData] = useState<any[]>([]);
    const [subject, setSubject] = useState("");
    const [body, setBody] = useState("");

    useEffect(() => {
        if (!csvRaw.trim()) {
            setCsvHeaders([]);
            setCsvData([]);
            return;
        }
        Papa.parse(csvRaw, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                if (results.data && results.data.length > 0) {
                    setCsvHeaders(results.meta.fields || []);
                    setCsvData(results.data);
                } else {
                    setCsvHeaders([]);
                    setCsvData([]);
                }
            }
        });
    }, [csvRaw]);

    const replaceVariables = (text: string, row: any) => {
        if (!text || !row) return text;
        let res = text;
        // Case-insensitive replacement for CSV variables
        for (const [key, val] of Object.entries(row)) {
            const regex = new RegExp(`{{${key.trim()}}}`, 'gi');
            res = res.replace(regex, String(val || ''));
        }
        // Fallback standard replacements
        res = res.replace(/{{name}}/gi, row.name || row.Name || row['First Name'] || 'John')
                 .replace(/{{email}}/gi, row.email || row.Email || 'john@example.com');
        return res;
    };

    // Heuristic: Find which column actually contains an email by checking row values
    const extractLeads = () => {
        if (csvData.length === 0) return [];
        
        let emailCol = "";
        let nameCol = "";

        // Look at headers first
        const headers = csvHeaders.map(h => h.trim().toLowerCase());
        const emailIdx = headers.findIndex(h => h === 'email' || h.includes('email'));
        const nameIdx = headers.findIndex(h => h === 'name' || h === 'first name' || h.includes('name'));

        if (emailIdx !== -1) emailCol = csvHeaders[emailIdx];
        if (nameIdx !== -1) nameCol = csvHeaders[nameIdx];

        // Heuristic fallback: Scan first 5 rows for an '@' symbol if emailCol not found
        if (!emailCol) {
            const sampleRows = csvData.slice(0, 5);
            for (const header of csvHeaders) {
                const hasEmail = sampleRows.some(row => String(row[header]).includes('@'));
                if (hasEmail) {
                    emailCol = header;
                    break;
                }
            }
        }

        if (!emailCol) {
            console.error("Could not identify email column from data:", csvData[0]);
            return [];
        }

        return csvData.map(row => {
            const email = String(row[emailCol] || "").trim().replace(/^"|"$/g, '');
            const nameVal = nameCol ? String(row[nameCol] || "").trim().replace(/^"|"$/g, '') : "";
            const variables = {};
            // Clean up variables keys
            for (const [k, v] of Object.entries(row)) {
                (variables as any)[k.trim()] = v;
            }
            return { email, name: nameVal, variables };
        }).filter(l => l.email && l.email.includes('@'));
    };

    const validLeads = extractLeads();

    const handleNext = () => setStep((s) => Math.min(s + 1, 4));
    const handleBack = () => setStep((s) => Math.max(s - 1, 1));

    const startCampaign = async () => {
        setIsSubmitting(true);
        try {
            const leads = extractLeads();
            if (!name || !subject || !body || leads.length === 0) {
                toast.error(leads.length === 0 ? "No valid leads found in CSV (must contain @)" : "Please fill all required fields");
                setIsSubmitting(false);
                return;
            }

            console.log(`Submitting campaign with ${leads.length} leads.`, { name, leadsSample: leads.slice(0, 1) });

            const response = await api.post(`/campaigns`, {
                name, delayMin, delayMax, subject, body, leads
            });

            console.log("Response:", response.data);
            toast.success("Campaign Started Successfully");
            navigate("/campaigns");
        } catch (err: any) {
            console.error("Failed to start campaign:", err);
            toast.error(err.response?.data?.error || "Error starting campaign");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="space-y-6 max-w-3xl mx-auto">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate("/campaigns")}><ArrowLeft className="h-5 w-5" /></Button>
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">New Campaign</h1>
                    <p className="text-sm text-muted-foreground mt-1">Configure and launch a new outreach campaign.</p>
                </div>
            </div>

            <div className="flex items-center justify-between mb-8 px-4">
                {STEPS.map((s) => (
                    <div key={s.num} className="flex flex-col items-center gap-2">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-full border-2 ${step >= s.num ? "border-primary bg-primary text-primary-foreground" : "border-muted bg-background text-muted-foreground"}`}>
                            <s.icon className="h-4 w-4" />
                        </div>
                        <span className={`text-xs font-medium ${step >= s.num ? "text-foreground" : "text-muted-foreground"}`}>{s.label}</span>
                    </div>
                ))}
            </div>

            <Card>
                <CardContent className="p-6">
                    {step === 1 && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                            <h2 className="text-lg font-medium tracking-tight">Campaign Settings</h2>
                            <div className="space-y-1.5">
                                <Label>Campaign Name *</Label>
                                <Input placeholder="e.g., Q4 Enterprise Outreach" value={name} onChange={e => setName(e.target.value)} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <Label>Min Delay (seconds)</Label>
                                    <Input type="number" value={delayMin} onChange={e => setDelayMin(parseInt(e.target.value) || 60)} />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Max Delay (seconds)</Label>
                                    <Input type="number" value={delayMax} onChange={e => setDelayMax(parseInt(e.target.value) || 120)} />
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground">The system will wait a random duration between Min and Max Delay before sending each next email, mimicking human behavior.</p>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                            <h2 className="text-lg font-medium tracking-tight">Upload Leads</h2>

                            <div className="space-y-1.5">
                                <Label>Upload CSV File</Label>
                                <div className="flex items-center gap-2">
                                    <Input type="file" accept=".csv" onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        const reader = new FileReader();
                                        reader.onload = (evt) => {
                                            setCsvRaw(evt.target?.result as string);
                                        };
                                        reader.readAsText(file);
                                    }} />
                                </div>
                            </div>

                            <div className="relative py-4">
                                <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
                                <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">Or paste raw dataset</span></div>
                            </div>

                            <div className="space-y-1.5">
                                <Label>Paste CSV Data (First row must be headers)</Label>
                                <Textarea
                                    placeholder={"email,name,company,role\njohn@ex.com,John Doe,Acme,CEO\nmary@ex.com,Mary,Globex,CTO"}
                                    className="min-h-[150px] font-mono whitespace-pre text-sm"
                                    value={csvRaw}
                                    onChange={e => setCsvRaw(e.target.value)}
                                />
                            </div>

                            {csvHeaders.length > 0 && (
                                <div className="text-xs text-muted-foreground bg-muted p-3 rounded-md border border-border mt-4">
                                    <div className="mb-2"><strong className="text-foreground">Detected Variables:</strong> <span className="font-mono text-primary">{csvHeaders.map(h => `{{${h}}}`).join(', ')}</span></div>
                                    <div><strong className="text-foreground">Detected Valid Rows:</strong> {csvData.length}</div>
                                </div>
                            )}
                        </div>
                    )}

                    {step === 3 && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                            <h2 className="text-lg font-medium tracking-tight">Email Template</h2>
                            <div className="space-y-1.5">
                                <Label>Subject *</Label>
                                <Input placeholder="Quick question about {{company}}" value={subject} onChange={e => setSubject(e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Body (HTML/Text) *</Label>
                                <Textarea
                                    className="min-h-[200px]"
                                    placeholder={"Hi {{name}},\n\nI noticed that {{company}} is..."}
                                    value={body}
                                    onChange={e => setBody(e.target.value)}
                                />
                            </div>
                            <p className="text-xs text-muted-foreground">You can use any variables detected from your CSV headers: <span className="font-mono">{csvHeaders.length > 0 ? csvHeaders.map(h => `{{${h}}}`).join(', ') : "{{email}}, {{name}}"}</span></p>
                        </div>
                    )}

                    {step === 4 && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                            <h2 className="text-lg font-medium tracking-tight">Confirm & Launch</h2>
                            <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
                                <div className="flex justify-between border-b pb-2"><span className="text-muted-foreground">Campaign:</span> <span className="font-medium">{name || "Unnamed"}</span></div>
                                <div className="flex justify-between border-b py-2"><span className="text-muted-foreground">Valid Leads Found:</span> <span className={`font-bold ${validLeads.length > 0 ? "text-green-600" : "text-destructive"}`}>{validLeads.length}</span></div>
                                <div className="flex justify-between border-b py-2"><span className="text-muted-foreground">Inter-Send Delay:</span> <span className="font-medium">{delayMin}s - {delayMax}s</span></div>
                            </div>

                            <div className="rounded-lg border p-4 space-y-2">
                                <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-2">Subject Preview (Row 1)</p>
                                <p className="font-medium text-sm mb-4">{csvData.length > 0 ? replaceVariables(subject, csvData[0]) : subject}</p>

                                <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-2">Body Preview (Row 1)</p>
                                <div className="p-3 bg-muted/50 rounded text-sm whitespace-pre-wrap">
                                    {csvData.length > 0 ? replaceVariables(body, csvData[0]) : body}
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="flex justify-between pt-6 mt-6 border-t">
                        <Button variant="outline" onClick={handleBack} disabled={step === 1 || isSubmitting}>Back</Button>
                        {step < 4 ? (
                            <Button onClick={handleNext}>Continue</Button>
                        ) : (
                            <Button onClick={startCampaign} disabled={isSubmitting}>
                                {isSubmitting ? "Starting..." : "Start Campaign"} <Send className="ml-2 h-4 w-4" />
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>

        </div>
    );
}
