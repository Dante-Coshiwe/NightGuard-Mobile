import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

export default function PatrolsScreen({ navigation }) {
  const [patrols, setPatrols] = useState([]);
  const [loading, setLoading] = useState(true);
  const { user, logout } = useAuth();

  useEffect(() => {
    fetchPatrols();
  }, []);

  const fetchPatrols = async () => {
    try {
      const response = await api.get('/guard/patrols');
      setPatrols(response.data);
    } catch (error) {
      console.error('Failed to fetch patrols', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#dc2626" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Patrols</Text>
        <TouchableOpacity onPress={logout}>
          <Text style={styles.logout}>Logout</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={patrols}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('PatrolDetail', { patrol: item })}
          >
            <Text style={styles.patrolName}>{item.patrol_name}</Text>
            <Text style={styles.patrolStatus}>Status: {item.status}</Text>
            <Text style={styles.patrolProgress}>Checkpoints: {item.checkpoints_completed}/{item.total_checkpoints}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No active patrols</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', padding: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  logout: { color: '#dc2626', fontSize: 16 },
  card: { backgroundColor: '#1a1a1a', padding: 16, borderRadius: 8, marginBottom: 12 },
  patrolName: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  patrolStatus: { color: '#ccc', marginBottom: 4 },
  patrolProgress: { color: '#999', fontSize: 14 },
  empty: { color: '#666', textAlign: 'center', marginTop: 40 },
});