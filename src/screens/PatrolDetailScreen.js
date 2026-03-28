import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Button, Alert, FlatList } from 'react-native';
import * as NfcManager from 'expo-nfc';

export default function PatrolDetailScreen({ route }) {
  const { patrol } = route.params;
  const [checkpoints, setCheckpoints] = useState(patrol.patrol_checkpoints || []);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    const initNfc = async () => {
      try {
        await NfcManager.start();
      } catch (err) {
        console.warn('NFC not supported', err);
      }
    };
    initNfc();

    return () => {
      NfcManager.stop();
    };
  }, []);

  const startNfcScan = async () => {
    setScanning(true);
    try {
      await NfcManager.registerTagEvent(async (tag) => {
        Alert.alert('Tag scanned', `Tag ID: ${tag.id}`);
        // TODO: call API to verify checkpoint
        setScanning(false);
        NfcManager.unregisterTagEvent();
      }, {
        alertMessage: 'Hold your device near the checkpoint tag',
      });
    } catch (error) {
      Alert.alert('NFC Error', error.message);
      setScanning(false);
    }
  };

  const cancelScan = () => {
    NfcManager.unregisterTagEvent();
    setScanning(false);
  };

  const renderCheckpoint = ({ item }) => (
    <View style={styles.checkpointCard}>
      <Text style={styles.checkpointName}>{item.checkpoint_name}</Text>
      <Text style={styles.checkpointStatus}>Status: {item.status || 'pending'}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{patrol.patrol_name}</Text>
      <FlatList
        data={checkpoints}
        keyExtractor={(item, idx) => idx.toString()}
        renderItem={renderCheckpoint}
        ListEmptyComponent={<Text style={styles.empty}>No checkpoints</Text>}
      />
      <View style={styles.buttonContainer}>
        {!scanning ? (
          <Button title="Scan Next Checkpoint" onPress={startNfcScan} color="#dc2626" />
        ) : (
          <Button title="Cancel Scan" onPress={cancelScan} color="#666" />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', padding: 20 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 20 },
  checkpointCard: { backgroundColor: '#1a1a1a', padding: 16, borderRadius: 8, marginBottom: 12 },
  checkpointName: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  checkpointStatus: { color: '#ccc' },
  empty: { color: '#666', textAlign: 'center', marginTop: 40 },
  buttonContainer: { marginTop: 20, marginBottom: 20 },
});