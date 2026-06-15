require('dotenv').config();
const express = require('express');
const mqtt = require('mqtt');
const { InfluxDB } = require('@influxdata/influxdb-client'); // Point dihapus karena tidak dipakai
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Inisialisasi InfluxDB Client (HANYA UNTUK QUERY / MEMBACA DATA)
const influxDB = new InfluxDB({ url: process.env.INFLUX_URL, token: process.env.INFLUX_TOKEN });
const queryApi = influxDB.getQueryApi(process.env.INFLUX_ORG);
// writeApi sudah dihapus

// Variabel penampung data realtime terakhir untuk Dashboard
let latestSensorData = {
    temperature: 0,
    humidity: 0,
    fanStatus: false,
    mistStatus: false,
    time: '--:--:--'
};

// Koneksi MQTT Broker
const mqttClient = mqtt.connect(process.env.MQTT_BROKER);

mqttClient.on('connect', () => {
    console.log('✓ Terhubung ke MQTT Broker');
    mqttClient.subscribe(process.env.MQTT_TOPIC_DATA);
});

mqttClient.on('message', (topic, message) => {
    if (topic === process.env.MQTT_TOPIC_DATA) {
        try {
            const data = JSON.parse(message.toString());
            
            const parseStatus = (val) => {
                if (val === 'ON' || val === 'on' || val === 1 || val === true) return true;
                return false;
            };
            
            // Tetap perbarui variabel ini agar API Realtime (Dashboard) tidak mati
            latestSensorData = {
                temperature: Number(data.temperature ?? data.suhu ?? 0),
                humidity: Number(data.humidity ?? data.kelembapan ?? 0),
                fanStatus: parseStatus(data.fan ?? data.fanStatus),
                mistStatus: parseStatus(data.mist ?? data.mistStatus),
                time: new Date().toLocaleTimeString('id-ID')
            };

            // KODE PENYIMPANAN INFLUXDB TELAH DIHAPUS DARI SINI
            // Penyimpanan sekarang sepenuhnya ditangani oleh Node-RED

        } catch (error) {
            console.error('Gagal memproses payload MQTT:', error);
        }
    }
});

// Endpoint 1: Mengambil Data Realtime Terakhir (Untuk Dashboard)
app.get('/api/realtime', (req, res) => {
    res.json(latestSensorData);
});

// Endpoint 2: Mengirim Perintah Pengendalian
app.post('/api/control', (req, res) => {
    const { device, state } = req.body;
    const payload = `${device.toUpperCase()}_${state.toUpperCase()}`; 
    mqttClient.publish(process.env.MQTT_TOPIC_CONTROL, payload);
    res.json({ success: true, message: `Command ${payload} terkirim ke MQTT.` });
});

// Endpoint 3: Query Data Historis Menggunakan Flux Query (DATA MENTAH)
app.get('/api/history', async (req, res) => {
    const { range, start, end } = req.query;
    let rangeQuery = '';

    if (range === 'custom' && start && end) {
        rangeQuery = `|> range(start: ${new Date(start).toISOString()}, stop: ${new Date(end).toISOString()})`;
    } else {
        const validRanges = ['1h', '12h', '24h', '7d', '30d'];
        const selectedRange = validRanges.includes(range) ? range : '24h';
        rangeQuery = `|> range(start: -${selectedRange})`;
    }

    const fluxQuery = `
        from(bucket: "sensoraht20")
            ${rangeQuery}
            |> filter(fn: (r) => r["_measurement"] == "sensoraht20")
            |> filter(fn: (r) => r["_field"] == "kelembapan" or r["_field"] == "suhu" or r["_field"] == "fanStatus" or r["_field"] == "mistStatus")
            |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
            |> sort(columns: ["_time"], desc: true)
            |> limit(n: 5000)
    `;

    const logs = [];
    try {
        queryApi.queryRows(fluxQuery, {
            next(row, tableMeta) {
                const o = tableMeta.toObject(row);
                logs.push({
                    time: new Date(o._time).toLocaleString('id-ID'),
                    temp: o.suhu ?? 0,
                    hum: o.kelembapan ?? 0,
                    fStatus: o.fanStatus ?? false,
                    mStatus: o.mistStatus ?? false
                });
            },
            error(error) {
                console.error('InfluxDB Query Error:', error);
                res.status(500).json({ error: 'Gagal melakukan query database' });
            },
            complete() {
                res.json(logs);
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Endpoint 4: Query Khusus Grafik Dinamis (DATA MENTAH)
app.get('/api/chart-data', async (req, res) => {
    const { range, start, end } = req.query;
    let rangeQuery = '';

    if (range === 'custom' && start && end) {
        rangeQuery = `|> range(start: ${new Date(start).toISOString()}, stop: ${new Date(end).toISOString()})`;
    } else {
        const validRanges = ['1h', '12h', '24h', '7d', '30d'];
        const selectedRange = validRanges.includes(range) ? range : '24h';
        rangeQuery = `|> range(start: -${selectedRange})`;
    }

    const fluxQuery = `
        from(bucket: "sensoraht20")
            ${rangeQuery}
            |> filter(fn: (r) => r["_measurement"] == "sensoraht20")
            |> filter(fn: (r) => r["_field"] == "kelembapan" or r["_field"] == "suhu")
            |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
            |> sort(columns: ["_time"], desc: false)
    `;

    const chartData = { labels: [], temps: [], hums: [] };
    try {
        queryApi.queryRows(fluxQuery, {
            next(row, tableMeta) {
                const o = tableMeta.toObject(row);
                const d = new Date(o._time);
                
                const hours = String(d.getHours()).padStart(2,'0');
                const mins = String(d.getMinutes()).padStart(2,'0');
                const secs = String(d.getSeconds()).padStart(2,'0');
                
                const timeLabel = (range === '7d' || range === '30d' || range === 'custom') 
                    ? `${d.getDate()}/${d.getMonth()+1} ${hours}:${mins}:${secs}`
                    : `${hours}:${mins}:${secs}`;
                
                chartData.labels.push(timeLabel);
                chartData.temps.push(o.suhu ?? null);
                chartData.hums.push(o.kelembapan ?? null);
            },
            error(error) { res.status(500).json({ error: 'Gagal query grafik' }); },
            complete() { res.json(chartData); }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server monolit IoT berjalan di http://localhost:${PORT}`);
});