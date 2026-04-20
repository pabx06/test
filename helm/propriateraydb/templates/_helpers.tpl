{{- define "propriateraydb.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "propriateraydb.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else if .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- include "propriateraydb.name" . -}}
{{- end -}}
{{- end -}}

{{- define "propriateraydb.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "propriateraydb.labels" -}}
helm.sh/chart: {{ include "propriateraydb.chart" . }}
app.kubernetes.io/name: {{ include "propriateraydb.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "propriateraydb.selectorLabels" -}}
app.kubernetes.io/name: {{ include "propriateraydb.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "propriateraydb.componentLabels" -}}
{{ include "propriateraydb.selectorLabels" . }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "propriateraydb.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "propriateraydb.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "propriateraydb.frontendImage" -}}
{{- if .Values.frontend.image.digest -}}
{{- printf "%s@%s" .Values.frontend.image.repository .Values.frontend.image.digest -}}
{{- else -}}
{{- printf "%s:%s" .Values.frontend.image.repository .Values.frontend.image.tag -}}
{{- end -}}
{{- end -}}

{{- define "propriateraydb.backendImage" -}}
{{- if .Values.backend.image.digest -}}
{{- printf "%s@%s" .Values.backend.image.repository .Values.backend.image.digest -}}
{{- else -}}
{{- printf "%s:%s" .Values.backend.image.repository .Values.backend.image.tag -}}
{{- end -}}
{{- end -}}
