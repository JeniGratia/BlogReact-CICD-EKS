pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
        timeout(time: 30, unit: 'MINUTES')
    }

    environment {
        APP_NAMESPACE  = 'blogapp'
        BACKEND_IMAGE  = 'blogreact-backend:local'
        FRONTEND_IMAGE = 'blogreact-frontend:local'
        NODE_IMAGE     = 'node:20-alpine'
        KUBECTL_IMAGE  = 'bitnami/kubectl:latest'
        KIND_NODE      = 'blog-project-control-plane'
        KUBE_CONFIG    = '/home/user/projects/BlogReact/jenkins-kubeconfig'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Backend Tests and Lint') {
            steps {
                dir('backend') {
                    sh '''
                        set -eu

                        CID=$(docker create \
                            -w /app \
                            "$NODE_IMAGE" \
                            sh -ec "npm install --no-package-lock --no-audit --no-fund && npm test && npm run lint")

                        trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT

                        docker cp . "$CID":/app
                        docker start -a "$CID"
                    '''
                }
            }
        }

        stage('Frontend Lint and Build') {
            steps {
                dir('frontend') {
                    sh '''
                        set -eu

                        CID=$(docker create \
                            -w /app \
                            "$NODE_IMAGE" \
                            sh -ec "npm install --no-package-lock --no-audit --no-fund && npm run lint && npm run build")

                        trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT

                        docker cp . "$CID":/app
                        docker start -a "$CID"
                    '''
                }
            }
        }

        stage('Build and Load Images') {
            steps {
                sh '''
                    set -eu

                    echo "Building backend image..."
                    docker build --provenance=false \
                        -t "$BACKEND_IMAGE" ./backend

                    echo "Building frontend image..."
                    docker build --provenance=false \
                        -t "$FRONTEND_IMAGE" ./frontend

                    echo "Checking kind node..."
                    docker exec "$KIND_NODE" crictl images >/dev/null

                    echo "Loading backend image into kind..."
                    docker save "$BACKEND_IMAGE" |
                        docker exec -i "$KIND_NODE" \
                        ctr --namespace=k8s.io images import -

                    echo "Loading frontend image into kind..."
                    docker save "$FRONTEND_IMAGE" |
                        docker exec -i "$KIND_NODE" \
                        ctr --namespace=k8s.io images import -

                    echo "Verifying imported images..."
                    docker exec "$KIND_NODE" crictl images |
                        grep blogreact
                '''
            }
        }

        stage('Validate Kubernetes Manifests') {
            steps {
                sh '''
                    set -eu

                    echo "Checking kubeconfig file..."
                    test -f "$KUBE_CONFIG" || {
                        echo "ERROR: Kubeconfig file not found: $KUBE_CONFIG"
                        exit 1
                    }

                    kubectl_docker() {
                        docker run --rm \
                            --network kind \
                            -v "$KUBE_CONFIG:/root/.kube/config:ro" \
                            -e KUBECONFIG=/root/.kube/config \
                            -v "$WORKSPACE:/workspace:ro" \
                            -w /workspace \
                            "$KUBECTL_IMAGE" "$@"
                    }

                    echo "Checking Kubernetes connectivity..."
                    kubectl_docker \
                        --request-timeout=15s \
                        get namespace "$APP_NAMESPACE"

                    echo "Validating backend deployment..."
                    kubectl_docker apply \
                        --dry-run=client \
                        -f k8s/backend/deployment.yaml

                    echo "Validating backend service..."
                    kubectl_docker apply \
                        --dry-run=client \
                        -f k8s/backend/service.yaml

                    echo "Validating frontend deployment..."
                    kubectl_docker apply \
                        --dry-run=client \
                        -f k8s/frontend/deployment.yaml

                    echo "Validating frontend service..."
                    kubectl_docker apply \
                        --dry-run=client \
                        -f k8s/frontend/service.yaml
                '''
            }
        }

        stage('Deploy to Kubernetes') {
            steps {
                sh '''
                    set -eu

                    kubectl_docker() {
                        docker run --rm \
                            --network kind \
                            -v "$KUBE_CONFIG:/root/.kube/config:ro" \
                            -e KUBECONFIG=/root/.kube/config \
                            -v "$WORKSPACE:/workspace:ro" \
                            -w /workspace \
                            "$KUBECTL_IMAGE" "$@"
                    }

                    echo "Applying backend deployment..."
                    kubectl_docker apply \
                        -f k8s/backend/deployment.yaml

                    echo "Applying backend service..."
                    kubectl_docker apply \
                        -f k8s/backend/service.yaml

                    echo "Applying frontend deployment..."
                    kubectl_docker apply \
                        -f k8s/frontend/deployment.yaml

                    echo "Applying frontend service..."
                    kubectl_docker apply \
                        -f k8s/frontend/service.yaml

                    echo "Waiting for backend rollout..."
                    kubectl_docker rollout status \
                        deployment/backend \
                        -n "$APP_NAMESPACE" \
                        --timeout=180s

                    echo "Waiting for frontend rollout..."
                    kubectl_docker rollout status \
                        deployment/frontend \
                        -n "$APP_NAMESPACE" \
                        --timeout=180s
                '''
            }
        }

        stage('Smoke Test') {
            steps {
                sh '''
                    set -eu

                    kubectl_docker() {
                        docker run --rm \
                            --network kind \
                            -v "$KUBE_CONFIG:/root/.kube/config:ro" \
                            -e KUBECONFIG=/root/.kube/config \
                            "$KUBECTL_IMAGE" "$@"
                    }

                    echo "Checking backend availability..."
                    kubectl_docker wait \
                        --for=condition=Available \
                        deployment/backend \
                        -n "$APP_NAMESPACE" \
                        --timeout=120s

                    echo "Checking frontend availability..."
                    kubectl_docker wait \
                        --for=condition=Available \
                        deployment/frontend \
                        -n "$APP_NAMESPACE" \
                        --timeout=120s

                    echo "Running application health check..."
                    kubectl_docker run \
                        "jenkins-smoke-${BUILD_NUMBER}" \
                        -n "$APP_NAMESPACE" \
                        --image=curlimages/curl:8.12.1 \
                        --restart=Never \
                        --rm -i \
                        --quiet \
                        --command -- \
                        curl --fail --silent --show-error \
                        --retry 10 \
                        --retry-connrefused \
                        --retry-delay 2 \
                        http://frontend-service/api/healthz

                    echo "Smoke test completed successfully."
                '''
            }
        }
    }

    post {
        success {
            echo 'Local CI/CD pipeline and smoke test succeeded.'
        }

        failure {
            echo 'Pipeline failed. Check the first failing stage and its error.'
        }

        always {
            echo 'Pipeline finished.'
        }
    }
}

