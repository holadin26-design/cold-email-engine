import axios from 'axios';

async function testBulkVerify() {
    const emails = [
        'test@google.com',
        'test@gmail.com',
        'test@outlook.com',
        'test@microsoft.com',
        'test@apple.com'
    ];

    console.log(`Starting bulk verification of ${emails.length} emails...`);
    const startTime = Date.now();

    try {
        const response = await axios.post('http://localhost:4000/api/finder/verify-bulk', { emails });
        const endTime = Date.now();
        console.log(`Finished in ${(endTime - startTime) / 1000}s`);
        console.log('Results count:', response.data.results.length);
        // console.log('Sample result:', response.data.results[0]);
    } catch (error: any) {
        console.error('Error during bulk verification:', error.response?.data || error.message);
    }
}

testBulkVerify();
