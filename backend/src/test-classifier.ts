import { ReplyClassifier } from "./services/replyClassifier";

const testCases = [
    {
        name: "Positive - Interested",
        body: "Hey, thanks for reaching out. I am interested in learning more about your pricing.",
        expectedSentiment: "positive",
        expectedIsHuman: true
    },
    {
        name: "Positive - Demo request",
        body: "Can we hop on a call or do a demo next Tuesday?",
        expectedSentiment: "positive",
        expectedIsHuman: true
    },
    {
        name: "Negative - Unsubscribe",
        body: "Please unsubscribe me from your list immediately. stop.",
        expectedSentiment: "negative",
        expectedIsHuman: true
    },
    {
        name: "Negative - Not interested",
        body: "Not interested, thanks.",
        expectedSentiment: "negative",
        expectedIsHuman: true
    },
    {
        name: "Auto-reply - OOO",
        body: "I am currently out of the office until July 15th with limited access to email. For urgent matters, please contact support@example.com.",
        expectedSentiment: "neutral",
        expectedIsHuman: false
    },
    {
        name: "Auto-reply - Header style",
        body: "Re: Automatic reply: Case #123456",
        expectedSentiment: "neutral",
        expectedIsHuman: false
    },
    {
        name: "Neutral - Question",
        body: "What is your main differentiator?",
        expectedSentiment: "positive", // Question marks are treated as positive/interested
        expectedIsHuman: true
    },
    {
        name: "Neutral - Generic human",
        body: "I will get back to you later.",
        expectedSentiment: "neutral",
        expectedIsHuman: true
    }
];

console.log("--- Starting Reply Classifier Tests ---\n");

let passed = 0;
for (const tc of testCases) {
    const result = ReplyClassifier.classify(tc.body);
    const sentimentPassed = result.sentiment === tc.expectedSentiment;
    const humanPassed = !result.isAutoReply === tc.expectedIsHuman;

    if (sentimentPassed && humanPassed) {
        console.log(`✅ [PASS] ${tc.name}`);
        passed++;
    } else {
        console.error(`❌ [FAIL] ${tc.name}`);
        console.error(`   Expected: Sentiment=${tc.expectedSentiment}, IsHuman=${tc.expectedIsHuman}`);
        console.error(`   Actual:   Sentiment=${result.sentiment}, IsHuman=${!result.isAutoReply}`);
        console.error(`   Reason:   ${result.reason}\n`);
    }
}

console.log(`\n--- Results: ${passed}/${testCases.length} Passed ---`);
if (passed === testCases.length) {
    console.log("All tests passed successfully!");
} else {
    process.exit(1);
}
