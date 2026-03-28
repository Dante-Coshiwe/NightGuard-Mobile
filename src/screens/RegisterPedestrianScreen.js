import React, { useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Image, Alert, ActivityIndicator } from 'react-native';
import { Camera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import api from '../services/api';

export default function RegisterPedestrianScreen({ navigation }) {
  const [hasPermission, setHasPermission] = useState(null);
  const [cameraRef, setCameraRef] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [name, setName] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [contact, setContact] = useState('');
  const [visitingUnit, setVisitingUnit] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);

  React.useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const takePicture = async () => {
    if (cameraRef) {
      const photoData = await cameraRef.takePictureAsync({ quality: 0.7 });
      setPhoto(photoData.uri);
      setShowCamera(false);
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });
    if (!result.canceled) {
      setPhoto(result.assets[0].uri);
    }
  };

  const submitEntry = async () => {
    if (!name || !visitingUnit) {
      Alert.alert('Missing info', 'Please fill in name and visiting unit');
      return;
    }
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('full_name', name);
      formData.append('id_number', idNumber);
      formData.append('contact_number', contact);
      formData.append('visiting_unit', visitingUnit);
      if (photo) {
        formData.append('photo', {
          uri: photo,
          name: 'photo.jpg',
          type: 'image/jpeg',
        });
      }

      const response = await api.post('/pedestrians/entry', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      Alert.alert('Success', 'Pedestrian registered');
      navigation.goBack();
    } catch (error) {
      Alert.alert('Error', error.response?.data?.error || 'Failed to register');
    } finally {
      setLoading(false);
    }
  };

  if (hasPermission === null) return <View />;
  if (hasPermission === false) return <Text>No camera access</Text>;

  return (
    <View style={styles.container}>
      {showCamera ? (
        <View style={styles.cameraContainer}>
          <Camera style={styles.camera} ref={ref => setCameraRef(ref)} />
          <View style={styles.cameraButtons}>
            <TouchableOpacity style={styles.cameraButton} onPress={takePicture}>
              <Text style={styles.buttonText}>Take Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cameraButton} onPress={() => setShowCamera(false)}>
              <Text style={styles.buttonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <>
          <Text style={styles.title}>Register Pedestrian Entry</Text>
          <TextInput
            style={styles.input}
            placeholder="Full Name"
            value={name}
            onChangeText={setName}
            placeholderTextColor="#666"
          />
          <TextInput
            style={styles.input}
            placeholder="ID Number (optional)"
            value={idNumber}
            onChangeText={setIdNumber}
            placeholderTextColor="#666"
          />
          <TextInput
            style={styles.input}
            placeholder="Contact Number"
            value={contact}
            onChangeText={setContact}
            placeholderTextColor="#666"
          />
          <TextInput
            style={styles.input}
            placeholder="Visiting Unit"
            value={visitingUnit}
            onChangeText={setVisitingUnit}
            placeholderTextColor="#666"
          />
          <View style={styles.photoSection}>
            {photo ? (
              <Image source={{ uri: photo }} style={styles.preview} />
            ) : (
              <Text style={styles.photoPlaceholder}>No photo taken</Text>
            )}
            <View style={styles.photoButtons}>
              <TouchableOpacity style={styles.photoButton} onPress={() => setShowCamera(true)}>
                <Text style={styles.buttonText}>Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.photoButton} onPress={pickImage}>
                <Text style={styles.buttonText}>Choose from Gallery</Text>
              </TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity style={styles.submitButton} onPress={submitEntry} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Register Entry</Text>}
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', padding: 20 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 20 },
  input: { backgroundColor: '#1a1a1a', color: '#fff', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 16 },
  photoSection: { marginBottom: 20, alignItems: 'center' },
  preview: { width: 200, height: 200, borderRadius: 8, marginBottom: 12 },
  photoPlaceholder: { color: '#666', marginBottom: 12 },
  photoButtons: { flexDirection: 'row', gap: 12 },
  photoButton: { backgroundColor: '#333', padding: 10, borderRadius: 8, marginHorizontal: 6 },
  submitButton: { backgroundColor: '#dc2626', padding: 14, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: 'bold' },
  cameraContainer: { flex: 1 },
  camera: { flex: 1 },
  cameraButtons: { position: 'absolute', bottom: 20, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 20 },
  cameraButton: { backgroundColor: '#dc2626', padding: 12, borderRadius: 8, marginHorizontal: 10 },
});