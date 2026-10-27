pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
        timeout(time: 30, unit: 'MINUTES')
    }

    environment {
        APP_NAMESPACE = 'blogapp'
        BACKEND_IMAGE = 'blogreact-backend:local'
        FRONTEND_IMAGE = 'blogreact-frontend:local'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                sh 'git status --short'
            }
        }

        stage('Backend Tests and Lint') {
            steps {
                dir('backend') {
                    sh 'npm ci'
                    sh 'npm test'
                    sh 'npm run lint'
                }
            }
        }

        stage('Frontend Lint and Build') {
            steps {
                dir('frontend') {
                    sh 'npm ci'
                    sh 'npm run lint'
                    sh 'npm run build'
                }
            }
        }

        stage('Build Docker Images') {
            steps {
                sh 'docker build -t "$BACKEND_IMAGE" ./backend'
                sh 'docker build -t "$FRONTEND_IMAGE" ./frontend'
            }
        }

        stage('Validate Kubernetes Manifests') {
            steps {
                sh '''
                    kubectl apply --dry-run=client -f k8s/backend/deployment.yaml
                    kubectl apply --dry-run=client -f k8s/backend/service.yaml
                    kubectl apply --dry-run=client -f k8s/frontend/deployment.yaml
                    kubectl apply --dry-run=client -f k8s/frontend/service.yaml
                '''
            }
        }

        stage('Deploy to Local Kubernetes') {
            steps {
                sh '''
                    kubectl apply -f k8s/backend/deployment.yaml
                    kubectl apply -f k8s/backend/service.yaml
                    kubectl apply -f k8s/frontend/deployment.yaml
                    kubectl apply -f k8s/frontend/service.yaml

                    kubectl rollout status deployment/backend \
                        -n "$APP_NAMESPACE" --timeout=180s
                    kubectl rollout status deployment/frontend \
                        -n "$APP_NAMESPACE" --timeout=180s
                '''
            }
        }

        stage('Automated Deployment Validation') {
            steps {
                sh '''
                    set -eu

                    kubectl wait --for=condition=Available \
                        deployment/backend -n "$APP_NAMESPACE" --timeout=120s
                    kubectl wait --for=condition=Available \
                        deployment/frontend -n "$APP_NAMESPACE" --timeout=120s

                    test "$(kubectl get deployment backend -n "$APP_NAMESPACE" \
                        -o jsonpath='{.status.readyReplicas}')" = "2"
                    test "$(kubectl get deployment frontend -n "$APP_NAMESPACE" \
                        -o jsonpath='{.status.readyReplicas}')" = "2"

                    kubectl run "jenkins-smoke-${BUILD_NUMBER:-manual}" \
                        -n "$APP_NAMESPACE" \
                        --image=curlimages/curl:8.12.1 \
                        --restart=Never \
                        --rm -i --quiet \
                        --command -- \
                        curl --fail --silent --show-error \
                        --retry 10 --retry-connrefused --retry-delay 2 \
                        http://frontend-service/api/healthz

                    echo "Deployment validation passed."
                '''
            }
        }
    }

    post {
        success {
            echo 'CI pipeline and deployment validation succeeded.'
        }
        failure {
            echo 'Pipeline failed. Review the stage logs before proceeding.'
        }
        always {
            echo 'Pipeline execution finished.'
        }
    }
}
